const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

// 从环境变量读取飞书配置
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const SHEET_TOKEN = process.env.FEISHU_SHEET_TOKEN;

(async () => {
  console.log('1. 🚀 任务启动...');
  
  // 1. 先进行飞书鉴权 (获取 token)
  let accessToken = "";
  if (APP_ID && APP_SECRET && SHEET_TOKEN) {
      try {
          const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ "app_id": APP_ID, "app_secret": APP_SECRET })
          });
          const tokenJson = await tokenRes.json();
          if (tokenJson.code !== 0) throw new Error(`飞书鉴权失败: ${tokenJson.msg}`);
          accessToken = tokenJson.tenant_access_token;
          console.log('   ✅ 飞书连接成功！');
      } catch (e) {
          console.error('   ❌ 飞书配置错误:', e.message);
          process.exit(1); 
      }
  }

  // 2. 启动爬虫
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 正在抓取网页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    // === 精准提取逻辑 ===
    const accounts = await page.evaluate(() => {
        const results = [];
        const inputs = document.querySelectorAll('input');
        const processedUsers = new Set();

        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const val = input.value;
            if (val && val.includes('@')) {
                const username = val;
                let password = inputs[i+1] ? inputs[i+1].value : "";
                const card = input.closest('.card') || input.closest('.bg-white.rounded-2xl') || input.parentElement.parentElement.parentElement;
                
                if (card && !processedUsers.has(username)) {
                    let region = "未知";
                    let status = "正常";
                    
                    // 尝试从头部获取信息
                    const header = card.querySelector('.flex.justify-between') || card.firstElementChild;
                    if (header) {
                        const statusEl = header.querySelector('.text-emerald-700') || Array.from(header.querySelectorAll('div,span')).find(el => el.innerText.includes('正常'));
                        if (statusEl) status = statusEl.innerText.trim();
                        
                        const regionSpan = header.querySelector('span.font-bold');
                        if (regionSpan) region = regionSpan.innerText.trim();
                        else {
                            const leftSide = header.querySelector('.flex.gap-2');
                            if (leftSide) region = leftSide.innerText.trim().split(/\s+/).pop();
                        }
                    }
                    // 兜底逻辑
                    if(region === "未知" && card.innerText.includes("账号")) {
                         region = card.innerText.split("账号")[0].replace(/正常|异常|封禁|●/g, "").trim().split(/\s+/).pop();
                    }
                    results.push({ region, status, username, password });
                    processedUsers.add(username);
                }
            }
        }
        return results;
    });

    console.log(`3. 抓取完成，共 ${accounts.length} 条数据。`);
    
    // 保存本地备份
    fs.writeFileSync('data.json', JSON.stringify({ updated_at: new Date().getTime(), data: accounts }, null, 2));

    // 3. 同步到飞书
    if (accessToken && accounts.length > 0) {
        await syncToFeishu(accessToken, accounts);
    }

  } catch (error) {
    console.error('❌ 出错:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// === 飞书同步函数 (自动识别表名) ===
async function syncToFeishu(accessToken, data) {
    try {
        console.log('4. 正在查询表格信息...');
        
        // 关键步骤：查询工作表真实的名称 (是 Sheet1 还是 工作表1)
        const metaRes = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${SHEET_TOKEN}/sheets/query`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const metaJson = await metaRes.json();
        
        if (metaJson.code !== 0) {
            throw new Error(`查询表格失败: ${JSON.stringify(metaJson)} (请检查机器人是否已加入表格)`);
        }

        // 获取第一个工作表的真实名字
        const firstSheet = metaJson.data.sheets[0];
        const realSheetName = firstSheet.title;
        console.log(`   -> 识别到工作表名称为: "${realSheetName}"`);

        // 准备数据
        const checkTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const values = data.map(item => [item.region, item.status, item.username, item.password, checkTime]);
        
        // 填充空行，覆盖旧数据
        while (values.length < 50) values.push(["", "", "", "", ""]);

        // 使用查到的真实名字写入
        const range = `${realSheetName}!A2:E${values.length + 1}`;
        console.log(`   -> 正在写入 (Range: ${range})...`);

        const writeRes = await fetch(`https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SHEET_TOKEN}/values`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "valueRange": {
                    "range": range,
                    "values": values
                }
            })
        });

        const writeJson = await writeRes.json();
        if (writeJson.code !== 0) {
            throw new Error(`写入失败: ${JSON.stringify(writeJson)}`);
        }
        
        console.log('🎉 成功！数据已更新到飞书表格！');

    } catch (e) {
        console.error('❌ 飞书同步失败:', e.message);
    }
}

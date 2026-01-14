const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

// 环境变量
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const SHEET_TOKEN = process.env.FEISHU_SHEET_TOKEN;

(async () => {
  console.log('1. 🚀 任务启动...');
  
  // 1. 飞书鉴权
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

  // 2. 启动浏览器
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    // 伪装 User-Agent 防止被拦截
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 正在打开网页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    // ===============================================
    // 👇 核心修复：基于 Label 定位，彻底解决颠倒问题
    // ===============================================
    const accounts = await page.evaluate(() => {
        const results = [];
        const processedUsers = new Set();

        // 1. 不再遍历 input，而是直接找“卡片”容器
        // 根据截图，卡片是 bg-white rounded-2xl 样式的 div
        const cards = document.querySelectorAll('.bg-white.rounded-2xl, .card');

        cards.forEach(card => {
            let username = "";
            let password = "";
            let region = "未知";
            let status = "正常";

            // --- A. 精准提取账号和密码 ---
            // 遍历卡片里的所有 label 标签
            const labels = card.querySelectorAll('label');
            labels.forEach(label => {
                const labelText = label.innerText.trim();
                
                // 找到 label 对应的父级容器，再找里面的 input
                // 结构通常是: div > label + div > input
                const container = label.parentElement; 
                if (container) {
                    const input = container.querySelector('input');
                    if (input) {
                        if (labelText.includes("账号")) {
                            username = input.value;
                        } else if (labelText.includes("密码")) {
                            password = input.value;
                        }
                    }
                }
            });

            // 只有当账号和密码都找到了，才处理 (避免无效卡片)
            if (username && password && !processedUsers.has(username)) {
                
                // --- B. 提取地区和状态 (沿用之前的精准逻辑) ---
                const header = card.querySelector('.flex.justify-between') || card.firstElementChild;
                if (header) {
                    // 找状态
                    const statusEl = header.querySelector('.text-emerald-700') || Array.from(header.querySelectorAll('div,span')).find(el => el.innerText.includes('正常'));
                    if (statusEl) status = statusEl.innerText.trim();
                    
                    // 找地区 (粗体字)
                    const regionSpan = header.querySelector('span.font-bold');
                    if (regionSpan) {
                        region = regionSpan.innerText.trim();
                    } else {
                        // 备选：找左侧容器
                        const leftSide = header.querySelector('.flex.gap-2');
                        if (leftSide) region = leftSide.innerText.trim().split(/\s+/).pop();
                    }
                }

                // 兜底：如果地区没找到，用暴力文本法
                if(region === "未知" && card.innerText.includes("账号")) {
                     const rawText = card.innerText.split("账号")[0];
                     region = rawText.replace(/正常|异常|封禁|●/g, "").trim().split(/\s+/).pop();
                }

                results.push({ region, status, username, password });
                processedUsers.add(username);
            }
        });

        return results;
    });

    console.log(`3. 抓取完成，共 ${accounts.length} 条数据。`);
    
    fs.writeFileSync('data.json', JSON.stringify({ updated_at: new Date().getTime(), data: accounts }, null, 2));

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

// === 飞书同步函数 (ID写入 + 自动表头) ===
async function syncToFeishu(accessToken, data) {
    try {
        console.log('4. 正在查询表格信息...');
        
        const metaRes = await fetch(`https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${SHEET_TOKEN}/sheets/query`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const metaJson = await metaRes.json();
        if (metaJson.code !== 0) throw new Error(`查询表格失败: ${JSON.stringify(metaJson)}`);

        // 获取真实的 sheet_id
        const firstSheet = metaJson.data.sheets[0];
        const realSheetId = firstSheet.sheet_id;

        // 1. 定义固定表头
        const header = ["地区", "状态", "账号", "密码", "更新时间"];
        
        // 2. 映射数据 (确保顺序绝对正确)
        const checkTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const dataRows = data.map(item => [
            item.region,   // A列
            item.status,   // B列
            item.username, // C列
            item.password, // D列
            checkTime      // E列
        ]);

        // 3. 合并表头 + 数据
        const allValues = [header, ...dataRows];

        // 4. 填充空行清理旧数据
        while (allValues.length < 50) allValues.push(["", "", "", "", ""]);

        // 5. 写入
        const range = `${realSheetId}!A1:E${allValues.length}`;
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
                    "values": allValues
                }
            })
        });

        const writeJson = await writeRes.json();
        if (writeJson.code !== 0) throw new Error(`写入失败: ${JSON.stringify(writeJson)}`);
        
        console.log('🎉 成功！数据顺序已修复！');

    } catch (e) {
        console.error('❌ 飞书同步失败:', e.message);
    }
}

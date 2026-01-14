const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

// 从 GitHub Secrets 读取配置
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const SHEET_TOKEN = process.env.FEISHU_SHEET_TOKEN;

(async () => {
  console.log('1. 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 打开网页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    console.log('3. 提取数据...');
    const accounts = await page.evaluate(() => {
        // === 这里是您之前验证成功的精准抓取逻辑 ===
        const results = [];
        const inputs = document.querySelectorAll('input');
        const processedUsers = new Set();

        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const val = input.value;
            if (val && val.includes('@')) {
                const username = val;
                let password = inputs[i+1] ? inputs[i+1].value : "";
                
                // 查找卡片
                const card = input.closest('.card') || input.closest('.bg-white.rounded-2xl') || input.parentElement.parentElement.parentElement;
                
                if (card && !processedUsers.has(username)) {
                    let region = "未知";
                    let status = "正常";

                    // 查找头部
                    const header = card.querySelector('.flex.justify-between') || card.firstElementChild;
                    if (header) {
                        const statusEl = header.querySelector('.text-emerald-700') || Array.from(header.querySelectorAll('div,span')).find(el => el.innerText.includes('正常'));
                        if (statusEl) status = statusEl.innerText.trim();

                        const regionSpan = header.querySelector('span.font-bold');
                        if (regionSpan) {
                            region = regionSpan.innerText.trim();
                        } else {
                            const leftSide = header.querySelector('.flex.gap-2');
                            if (leftSide) {
                                region = leftSide.innerText.trim().split(/\s+/).pop();
                            }
                        }
                    }
                    // 兜底
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

    console.log(`4. 抓取成功，共 ${accounts.length} 条。正在同步到飞书...`);
    
    // 如果配置了飞书信息，开始同步
    if (APP_ID && APP_SECRET && SHEET_TOKEN) {
        await syncToFeishu(accounts);
    } else {
        console.log('⚠️ 未配置飞书 Secrets，跳过同步。');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// ==========================================
// 👇 飞书 API 核心逻辑 (无需安装额外包)
// ==========================================

async function syncToFeishu(data) {
    try {
        // 1. 获取 tenant_access_token
        console.log('   -> 获取飞书访问凭证...');
        const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ "app_id": APP_ID, "app_secret": APP_SECRET })
        });
        const tokenJson = await tokenRes.json();
        if (tokenJson.code !== 0) throw new Error(`获取Token失败: ${tokenJson.msg}`);
        const accessToken = tokenJson.tenant_access_token;

        // 2. 格式化数据为二维数组 (飞书要求格式)
        const checkTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        // 映射数据到表格列: [地区, 状态, 账号, 密码, 更新时间]
        const values = data.map(item => [
            item.region, 
            item.status, 
            item.username, 
            item.password, 
            checkTime
        ]);

        // 为了美观，我们每次写入前填充一些空行，或者直接覆盖足够大的区域
        // 这里我们直接覆盖 A2 到 E200 的区域 (假设不超过 200 个账号)
        // 如果数据不够 200 行，飞书会自动用空数据覆盖旧数据，达到“清空旧数据”的效果
        
        // 补齐空行，确保清空残留数据
        while (values.length < 50) {
            values.push(["", "", "", "", ""]); // 填充空行
        }

        const range = "Sheet1!A2:E" + (values.length + 1); // 从 A2 开始写

        console.log(`   -> 正在写入表格 (Range: ${range})...`);
        
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
            throw new Error(`写入表格失败: ${JSON.stringify(writeJson)}`);
        }
        
        console.log('✅ 飞书表格同步成功！');

    } catch (e) {
        console.error('❌ 飞书同步出错:', e.message);
    }
}

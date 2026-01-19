const puppeteer = require('puppeteer-core');

// 目标网址
const BASE_URL = 'https://www.woko.pro/h/502/miemie';

// 从环境变量获取 Gist 配置
const GH_TOKEN = process.env.GH_TOKEN;
const GIST_ID = process.env.GIST_ID;

const randomSleep = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🚀 启动 Gist 极速同步爬虫...');
  const startTime = Date.now();
  
  // 1. 启动浏览器 (优化版配置)
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-cache', 
        '--disable-application-cache',
        '--window-size=1920,1080' // 保持窗口大小，防检测
    ]
  });

  try {
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 2. 伪装身份
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    // 3. 访问 (带随机参数防缓存)
    const targetUrl = `${BASE_URL}?v=${Date.now()}`;
    console.log(`-> 访问: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // 4. 模拟滚动
    try {
        await page.mouse.wheel({ deltaY: 500 });
        await sleep(2000);
    } catch (e) {}

    // 5. 提取数据 (带重试机制)
    const extractData = () => {
        const cards = document.querySelectorAll('.bg-white.rounded-2xl, .card');
        const data = [];
        const processed = new Set();
        cards.forEach(card => {
            let username = "", password = "", region = "未知", status = "正常";
            card.querySelectorAll('label').forEach(label => {
                const container = label.parentElement; 
                if (container) {
                    const input = container.querySelector('input');
                    if (input) {
                        if (label.innerText.includes("账号")) username = input.value;
                        else if (label.innerText.includes("密码")) password = input.value;
                    }
                }
            });
            if (username && password && !processed.has(username)) {
                const header = card.querySelector('.flex.justify-between') || card.firstElementChild;
                if (header) {
                    const statusEl = header.querySelector('.text-emerald-700') || Array.from(header.querySelectorAll('div,span')).find(el => el.innerText.includes('正常'));
                    if (statusEl) status = statusEl.innerText.trim();
                    const regionSpan = header.querySelector('span.font-bold');
                    if (regionSpan) region = regionSpan.innerText.trim();
                    else {
                        const left = header.querySelector('.flex.gap-2');
                        if (left) region = left.innerText.trim().split(/\s+/).pop();
                    }
                }
                if(region === "未知" && card.innerText.includes("账号")) region = "其他";
                data.push({ region, status, username, password });
                processed.add(username);
            }
        });
        return data;
    };

    let accounts = await page.evaluate(extractData);

    // 如果没抓到，重试一次
    if (accounts.length === 0) {
        console.log("⚠️ 第一次未抓到，等待 5s 重试...");
        await sleep(5000);
        accounts = await page.evaluate(extractData);
    }

    console.log(`📊 抓取到 ${accounts.length} 条数据 | 耗时 ${(Date.now() - startTime)/1000}s`);

    // 6. 核心：直接更新 Gist (秒级同步)
    if (accounts.length > 0 && GH_TOKEN && GIST_ID) {
        console.log("☁️ 正在上传到 Gist...");
        await updateGist(GH_TOKEN, GIST_ID, accounts);
    } else {
        console.log("❌ 跳过上传：数据为空 或 缺少 Gist 配置");
        if (accounts.length === 0) process.exit(0); // 即使没数据也不报错，保持循环
    }

  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await browser.close();
  }
})();

// Gist API 更新函数
async function updateGist(token, gistId, data) {
    try {
        const content = JSON.stringify({
            updated_at: new Date().getTime(),
            data: data
        }, null, 2);

        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Node.js Script'
            },
            body: JSON.stringify({
                files: {
                    "data.json": { content: content }
                }
            })
        });

        if (res.ok) console.log('✅ Gist 同步成功！网页已更新。');
        else console.error('❌ Gist 同步失败:', res.statusText);
    } catch (e) {
        console.error('❌ Gist 网络错误:', e.message);
    }
}

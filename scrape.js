const puppeteer = require('puppeteer-core');

// 目标网址
const BASE_URL = 'https://www.woko.pro/h/502/miemie';

// 环境变量
const GH_TOKEN = process.env.GH_TOKEN;
const GIST_ID = process.env.GIST_ID;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🛡️ 启动 Gist 稳健版爬虫 (重装甲模式)...');
  const startTime = Date.now();
  
  // 1. 启动配置：开启图片，窗口最大化，模拟真实用户
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-cache', 
        '--window-size=1920,1080', // 🖥️ 大窗口，防检测
    ]
  });

  try {
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 2. 深度伪装
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    // 3. 访问页面 (随机参数)
    const targetUrl = `${BASE_URL}?v=${Date.now()}`; 
    console.log(`-> 正在访问: ${targetUrl}`);
    
    // ⚠️ 改用 networkidle2：等待网络稍微空闲 (比 networkidle0 快，比 domcontentloaded 稳)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // 4. 模拟真人操作 (很重要！触发懒加载和绕过检测)
    console.log('-> 模拟真人浏览中...');
    try {
        await page.mouse.move(100, 100);
        await sleep(1000);
        await page.mouse.wheel({ deltaY: 800 }); // 滚下去
        await sleep(2000);
        await page.mouse.wheel({ deltaY: -300 }); // 滚上来
        await sleep(1000);
    } catch (e) {}

    // 5. 数据提取函数
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

    // 第一次尝试
    let accounts = await page.evaluate(extractData);

    // 6. 重试机制：如果没有数据，死等 8 秒再试一次
    if (accounts.length === 0) {
        console.log("⚠️ 第一次抓取为空，等待 8秒 重新扫描...");
        await sleep(8000);
        accounts = await page.evaluate(extractData);
    }

    console.log(`📊 最终抓取: ${accounts.length} 条数据`);

    // 7. 同步到 Gist
    if (accounts.length > 0) {
        if(GH_TOKEN && GIST_ID) {
            console.log("☁️ 正在同步到 Gist...");
            await updateGist(GH_TOKEN, GIST_ID, accounts);
        } else {
            console.error("❌ 缺少 Secrets 配置 (GH_TOKEN 或 GIST_ID)");
        }
    } else {
        console.log("❌ 两次尝试均未找到数据，跳过 Gist 更新 (保护旧数据)");
        // 打印标题帮助调试
        const title = await page.title();
        console.log(`当前页面标题: ${title}`);
    }

  } catch (error) {
    console.error('❌ 运行错误:', error.message);
  } finally {
    await browser.close();
  }
})();

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
            body: JSON.stringify({ files: { "data.json": { content: content } } })
        });

        if (res.ok) console.log('✅ Gist 同步成功！');
        else {
            console.error('❌ Gist 同步失败:', res.status, res.statusText);
            const errText = await res.text();
            console.error('错误详情:', errText);
        }
    } catch (e) {
        console.error('❌ 网络请求异常:', e.message);
    }
}

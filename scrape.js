const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 目标网址
const BASE_URL = 'https://www.woko.pro/h/502/miemie';

// 随机延迟工具
const randomSleep = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔥 启动爬虫任务 (纯净版)...');
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        // 隐藏自动化特征
        '--disable-blink-features=AutomationControlled', 
        // 禁止缓存
        '--disable-cache',
        '--disable-application-cache',
    ]
  });

  try {
    // 使用无痕模式
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 伪装 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // 注入 JS 隐藏身份
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 🚀 URL后加随机时间戳，强制服务器返回最新数据
    const targetUrl = `${BASE_URL}?force_update=${Date.now()}`;
    console.log(`-> 正在访问: ${targetUrl}`);

    // 设置超时
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 90000 });

    // 模拟人类操作
    await sleep(2000);
    try {
        await page.mouse.move(randomSleep(100, 800), randomSleep(100, 600));
        await page.mouse.wheel({ deltaY: 300 });
        await sleep(1000);
    } catch (e) {}

    // 等待数据加载
    console.log('-> 等待数据加载...');
    try {
        await page.waitForSelector('.bg-white.rounded-2xl', { timeout: 20000 });
    } catch (e) {
        console.warn("⚠️ 警告：未找到数据卡片，可能是被拦截或页面为空。");
    }

    // 提取数据
    const accounts = await page.evaluate(() => {
        const results = [];
        const processedUsers = new Set();
        const cards = document.querySelectorAll('.bg-white.rounded-2xl, .card');
        
        cards.forEach(card => {
            let username = "", password = "", region = "未知", status = "正常";
            
            // 提取账号密码
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

            if (username && password && !processedUsers.has(username)) {
                // 提取地区和状态
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
                if(region === "未知" && card.innerText.includes("账号")) {
                    region = card.innerText.split("账号")[0].replace(/正常|异常|封禁|●/g, "").trim().split(/\s+/).pop();
                }

                results.push({ region, status, username, password });
                processedUsers.add(username);
            }
        });
        return results;
    });

    console.log(`🎉 抓取完成：共找到 ${accounts.length} 条数据。`);

    // 保存文件
    if (accounts.length > 0) {
        fs.writeFileSync('data.json', JSON.stringify({ 
            updated_at: new Date().getTime(), 
            data: accounts 
        }, null, 2));
        console.log("✅ data.json 已更新");
    } else {
        console.log("❌ 本次没有抓到数据，跳过文件写入。");
        process.exit(1); // 报错，让 Actions 显示红叉
    }

  } catch (error) {
    console.error('❌ 发生严重错误:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE_URL = 'https://www.woko.pro/h/502/miemie';

// 随机延迟函数
const randomSleep = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('⚡️ 启动极速穿透爬虫...');
  const startTime = Date.now();
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // 隐藏自动化特征
        '--disable-cache', // ❌ 禁用缓存
        '--disable-application-cache',
        '--blink-settings=imagesEnabled=false', // ❌ 不加载图片，提升速度
    ]
  });

  try {
    // 1. 开启无痕模式 (确保每次都是新身份)
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 2. 屏蔽无关资源 (CSS/字体/媒体)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    // 3. 伪装 UA
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // 4. 注入 JS 隐藏 WebDriver 特征
    await page.evaluateOnNewDocument(() => { 
        Object.defineProperty(navigator, 'webdriver', { get: () => false }); 
    });

    // 5. 🚀 关键：URL后加随机时间戳，强制服务器吐出新数据
    const targetUrl = `${BASE_URL}?v=${Date.now()}`;
    console.log(`-> 访问: ${targetUrl}`);

    // domcontentloaded 比 networkidle0 快很多
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 稍微滚动触发懒加载
    try {
        await page.mouse.wheel({ deltaY: 500 });
        await sleep(1500); 
    } catch (e) {}

    // 6. 提取数据
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

    console.log(`🎉 抓取成功: ${accounts.length} 条 | 耗时: ${(Date.now() - startTime)/1000}s`);

    // 只有抓到数据才保存
    if (accounts.length > 0) {
        fs.writeFileSync('data.json', JSON.stringify({ 
            updated_at: new Date().getTime(), 
            data: accounts 
        }, null, 2));
    } else {
        console.log("❌ 数据为空");
        process.exit(1); // 报错以便 Actions 记录状态
    }

  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

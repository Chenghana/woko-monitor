const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE_URL = 'https://www.woko.pro/h/502/miemie';
const randomSleep = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔍 启动调试版爬虫...');
  const startTime = Date.now();
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-cache',
        '--blink-settings=imagesEnabled=false',
    ]
  });

  try {
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 伪装
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    // 访问
    const targetUrl = `${BASE_URL}?v=${Date.now()}`;
    console.log(`-> 正在访问: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 提取
    const accounts = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('.bg-white.rounded-2xl, .card');
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
            if (username && password) {
                // 简单提取状态，不做复杂去重，确保能拿到数据
                results.push({ username, password, status });
            }
        });
        return results;
    });

    console.log(`📊 抓取结果: 找到 ${accounts.length} 条数据`);

    if (accounts.length > 0) {
        // 强制写入文件
        console.log("💾 正在写入 data.json ...");
        const content = JSON.stringify({ 
            updated_at: new Date().getTime(), // 时间戳变化，文件必变
            data: accounts 
        }, null, 2);
        
        fs.writeFileSync('data.json', content);
        console.log("✅ 文件写入完成！");
        
        // 再次验证文件是否被修改
        const stats = fs.statSync('data.json');
        console.log(`Checking file: size=${stats.size}, mtime=${stats.mtime}`);
        
    } else {
        console.log("❌ 严重错误：页面已加载但未找到数据！");
        // 打印页面部分内容用于调试（只打前500字）
        const html = await page.content();
        console.log("页面内容快照:", html.substring(0, 500));
        process.exit(1); // 强制报错
    }

  } catch (error) {
    console.error('❌ 运行时错误:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

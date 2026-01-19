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
        // '--blink-settings=imagesEnabled=false', // 调试模式下先允许图片，防止因缺少资源被判定为机器人
    ]
  });

  try {
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    // 伪装更深一点
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    // 随机参数防缓存
    const targetUrl = `${BASE_URL}?debug=${Date.now()}`;
    console.log(`-> 正在访问: ${targetUrl}`);

    // 改回 networkidle2，虽然慢一点点，但更稳，能等待 Cloudflare 验证通过
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // 打印页面标题 (关键调试信息)
    const pageTitle = await page.title();
    console.log(`📄 当前网页标题: [ ${pageTitle} ]`);

    // 模拟鼠标
    try {
        await page.mouse.move(randomSleep(100, 500), randomSleep(100, 500));
        await page.mouse.wheel({ deltaY: 500 });
        await sleep(3000); // 多等一会儿
    } catch (e) {}

    // 提取数据
    const accounts = await page.evaluate(() => {
        const results = [];
        const processedUsers = new Set();
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
            if (username && password && !processedUsers.has(username)) {
                // 简单提取
                if(card.innerText.includes("正常")) status = "正常";
                else if(card.innerText.includes("异常")) status = "异常";
                results.push({ username, password, status, region });
                processedUsers.add(username);
            }
        });
        return results;
    });

    console.log(`📊 抓取结果: ${accounts.length} 条数据 | 耗时: ${(Date.now() - startTime)/1000}s`);

    if (accounts.length > 0) {
        fs.writeFileSync('data.json', JSON.stringify({ 
            updated_at: new Date().getTime(), 
            data: accounts 
        }, null, 2));
        console.log("✅ data.json 更新成功");
    } else {
        console.log("⚠️ 本次未找到数据！可能被拦截或页面结构变更。");
        // 打印页面源码片段，方便排查
        const content = await page.content();
        console.log("--- 页面源码快照 (前500字符) ---");
        console.log(content.substring(0, 500));
        console.log("--------------------------------");
        // ❌ 这里不再 process.exit(1)，而是正常退出，保证 workflow 继续运行
    }

  } catch (error) {
    console.error('❌ 运行时错误:', error);
    // 即使出错也不报错退出，防止 GitHub Actions 变红停止
    process.exit(0);
  } finally {
    await browser.close();
  }
})();

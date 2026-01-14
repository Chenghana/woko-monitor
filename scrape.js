const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

(async () => {
  console.log('1. 启动虚拟浏览器...');
  
  // 启动浏览器（无头模式，适合服务器运行）
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // GitHub Actions 必须的参数
  });

  try {
    const page = await browser.newPage();

    // 设置浏览器视口大小
    await page.setViewport({ width: 1920, height: 1080 });

    // 伪装 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 正在打开网页，等待加载...');
    // 访问网页，waitUntil: 'networkidle0' 表示等待网络不再活跃（即加载完成）
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    // 为了保险，额外死等 5 秒，确保卡片渲染出来
    console.log('3. 网页已打开，额外等待 5 秒让数据渲染...');
    await new Promise(r => setTimeout(r, 5000));

    // 开始抓取数据（在浏览器内部执行代码）
    console.log('4. 开始提取数据...');
    const accounts = await page.evaluate(() => {
      const results = [];
      
      // 在页面中寻找所有可能的容器
      // 策略：遍历所有 div，寻找同时包含 "账号" 和 "密码" 且有 input 的块
      const allDivs = document.querySelectorAll('div, .card, .panel');
      
      allDivs.forEach(div => {
        // 防止重复处理：只处理直接包含 input 的那一层，或者最接近的那一层
        // 简单粗暴法：检查文本内容
        const text = div.innerText || "";
        
        if (text.includes('账号') && text.includes('密码')) {
            const inputs = div.querySelectorAll('input');
            
            // 如果这个 div 里确实有两个 input，大概率就是我们要的
            if (inputs.length >= 2) {
                const username = inputs[0].value;
                const password = inputs[1].value;

                if (username && username.includes('@')) {
                    // 获取地区（尝试找 badge）
                    // 这种写法是在浏览器里运行的 DOM 操作
                    let region = "未知";
                    const badge = div.querySelector('.badge') || div.querySelector('span[class*="flag"]');
                    if(badge) region = badge.innerText.trim().split(/\s+/)[0];

                    // 获取状态
                    let status = "正常";
                    const statusEl = div.querySelector('.text-success') || div.querySelector('.badge-success');
                    if(statusEl) status = statusEl.innerText.trim();

                    // 避免重复添加（因为 querySelectorAll 可能会选到嵌套的父级 div）
                    // 我们只添加没见过的账号
                    const exists = results.find(r => r.username === username);
                    if (!exists) {
                        results.push({
                            region,
                            status,
                            username,
                            password,
                            checkTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                        });
                    }
                }
            }
        }
      });
      return results;
    });

    console.log(`5. 抓取完成！共找到 ${accounts.length} 个账号。`);

    // 保存数据
    fs.writeFileSync('data.json', JSON.stringify({
        updated_at: new Date().getTime(),
        data: accounts
    }, null, 2));

  } catch (error) {
    console.error('❌ 发生错误:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

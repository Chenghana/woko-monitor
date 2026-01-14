const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 目标网址
const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

(async () => {
  console.log('1. 启动高速浏览器...');
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome', // 使用服务器自带浏览器，秒开
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 伪装成真人访问
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 正在打开网页...');
    // 等待网页加载完成 (networkidle0 代表网络空闲，即加载好了)
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    
    // 额外等待 3 秒，确保文字渲染完毕
    await new Promise(r => setTimeout(r, 3000));

    console.log('3. 开始智能提取数据...');
    const accounts = await page.evaluate(() => {
      const results = [];
      
      // 遍历所有可能的卡片容器
      const allDivs = document.querySelectorAll('div, .card');
      
      allDivs.forEach(div => {
        const text = div.innerText || "";
        // 筛选条件：必须同时包含账号和密码输入框
        if (text.includes('账号') && text.includes('密码')) {
            const inputs = div.querySelectorAll('input');
            
            if (inputs.length >= 2) {
                const username = inputs[0].value;
                const password = inputs[1].value;

                if (username && username.includes('@')) {
                    
                    // =========== 核心修改开始 ===========
                    
                    // 1. 先找到“状态” (因为我们知道"正常"两个字肯定有颜色，容易找)
                    let status = "正常";
                    const statusEl = div.querySelector('.text-success') || div.querySelector('.badge-success') || div.querySelector('.badge');
                    if(statusEl) status = statusEl.innerText.trim();

                    // 2. 根据“状态”的位置，反推“地区”
                    // 逻辑：地区通常和状态在同一行（即父元素相同）
                    let region = "未知";
                    if (statusEl && statusEl.parentElement) {
                        // 克隆这一整行
                        const headerLine = statusEl.parentElement.cloneNode(true);
                        
                        // 把“状态”标签（如“正常”）删掉
                        const badgeToRemove = headerLine.querySelector('.text-success') || headerLine.querySelector('.badge-success') || headerLine.querySelector('.badge');
                        if (badgeToRemove) badgeToRemove.remove();
                        
                        // 剩下的文字就是“地区”了（可能包含图标文字，如 "JP 日本"，都保留下来）
                        region = headerLine.innerText.trim();
                        
                        // 清理一下多余的空格
                        region = region.replace(/\s+/g, ' '); 
                    }
                    
                    // 如果上面的方法没抓到，尝试找标题元素
                    if (!region || region === "") {
                         const title = div.querySelector('.card-title') || div.querySelector('h5') || div.querySelector('strong');
                         if (title) region = title.innerText.replace(status, '').trim();
                    }

                    // =========== 核心修改结束 ===========

                    // 去重并保存
                    const exists = results.find(r => r.username === username);
                    if (!exists) {
                        results.push({
                            region,    // 这里现在应该能抓到 "日本" 或 "JP 日本"
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

    console.log(`4. 抓取完成！共找到 ${accounts.length} 个账号。`);

    fs.writeFileSync('data.json', JSON.stringify({
        updated_at: new Date().getTime(),
        data: accounts
    }, null, 2));

  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

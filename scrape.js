const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

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
    
    // 伪装 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 打开网页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    // 网页加载后，稍微等一下数据渲染
    await new Promise(r => setTimeout(r, 4000));

    console.log('3. 根据 DOM 结构精准提取...');
    const accounts = await page.evaluate(() => {
      const results = [];
      const processedUsers = new Set();

      // 找到所有输入框
      const inputs = document.querySelectorAll('input');

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const val = input.value;

        // 定位账号
        if (val && val.includes('@')) {
            const username = val;
            let password = "";
            if (inputs[i+1]) password = inputs[i+1].value;
            
            // 找到卡片容器
            // 根据截图，input 上面几层就是 card
            const card = input.closest('.card') || input.closest('.bg-white.rounded-2xl') || input.parentElement.parentElement.parentElement;
            
            if (card && !processedUsers.has(username)) {
                
                let region = "未知";
                let status = "正常";

                // === 🔍 核心修改：根据您的截图精准查找 ===
                
                // 1. 查找头部行：截图显示头部是一个 flex justify-between 的 div
                // 我们在卡片内部找包含 "justify-between" 的元素，或者直接找头部区域
                const header = card.querySelector('.flex.justify-between') || card.firstElementChild;
                
                if (header) {
                    // 2. 提取状态：找绿色文字 (text-emerald-700 或 包含“正常”)
                    const statusEl = header.querySelector('.text-emerald-700') || Array.from(header.querySelectorAll('div,span')).find(el => el.innerText.includes('正常'));
                    if (statusEl) status = statusEl.innerText.trim();

                    // 3. 提取地区：精准查找截图里的 font-bold span
                    // 截图显示：<span class="font-bold text-slate-700">日本</span>
                    // 我们查找头部里的 bold span，且内容不是“正常”
                    const regionSpan = header.querySelector('span.font-bold');
                    
                    if (regionSpan) {
                        region = regionSpan.innerText.trim();
                    } else {
                        // 备用方案：如果 span 没找到，找头部左侧的容器
                        // 截图显示左侧有一个 .gap-2 的容器
                        const leftSide = header.querySelector('.flex.gap-2');
                        if (leftSide) {
                            region = leftSide.innerText.trim();
                            // 清理可能的重复 (如 "JP 日本")
                            const parts = region.split(/\s+/);
                            if (parts.length > 0) region = parts[parts.length - 1];
                        }
                    }
                }
                
                // 如果上面都失败了，使用之前的暴力文本法作为兜底
                if (region === "未知") {
                     const fullText = card.innerText || "";
                     if (fullText.includes("账号")) {
                         const headerText = fullText.split("账号")[0];
                         region = headerText.replace(/正常|异常|封禁|●/g, "").trim().split(/\s+/).pop();
                     }
                }

                results.push({
                    region,
                    status,
                    username,
                    password,
                    checkTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                });
                
                processedUsers.add(username);
            }
        }
      }
      return results;
    });

    console.log(`4. 提取完成，共 ${accounts.length} 条数据`);

    fs.writeFileSync('data.json', JSON.stringify({
        updated_at: new Date().getTime(),
        data: accounts
    }, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

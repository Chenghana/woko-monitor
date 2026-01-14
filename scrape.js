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
    
    // 等待 3 秒确保渲染
    await new Promise(r => setTimeout(r, 3000));

    console.log('3. 开始提取数据...');
    const accounts = await page.evaluate(() => {
      const results = [];
      
      // 找到所有输入框作为锚点
      const inputs = document.querySelectorAll('input');
      
      // 遍历所有 input，找到成对的账号密码
      // 我们假设每两个 input 是一组
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const val = input.value;

        // 如果这个输入框看起来像账号（包含 @）
        if (val && val.includes('@')) {
            const username = val;
            // 假设下一个输入框是密码
            const passwordInput = inputs[i + 1];
            const password = passwordInput ? passwordInput.value : "";

            if (password) {
                // 找到包含这两个输入框的最近的卡片容器
                // 通常是 .card 或 包含 input 的 div
                const card = input.closest('.card') || input.closest('div.bg-white') || input.parentElement.parentElement;

                if (card) {
                    // === 💡 核心修复：更强的地区查找逻辑 ===
                    let region = "未知";
                    let status = "正常";

                    // 1. 先找到状态标签 (绿色文字)
                    const statusEl = card.querySelector('.text-success') || card.querySelector('.badge-success') || card.querySelector('.badge');
                    
                    if (statusEl) {
                        status = statusEl.innerText.trim();

                        // 2. 从状态标签往上找 3 层，寻找包含额外文字的容器
                        // 这样可以跨越复杂的 div 结构
                        let parent = statusEl.parentElement;
                        for (let k = 0; k < 3; k++) {
                            if (!parent) break;
                            
                            // 获取该容器的全部文字
                            let text = parent.innerText;
                            
                            // 把“正常”去掉，把“复制”去掉，剩下的如果还有字，那就是地区！
                            text = text.replace(status, '').replace(/复制/g, '').trim();
                            
                            // 如果剩下的文字长度合适（不是空，也不是整个卡片的长文）
                            // 比如剩下 "JP 日本" 或 "日本"
                            if (text.length > 0 && text.length < 20) {
                                // 提取第一部分，通常就是我们要在的地区名
                                // 比如 "JP 日本" -> split 后取第一个或合并
                                // 为了保险，我们直接取整个剩余文本，然后清理换行
                                region = text.split(/\n/)[0].trim(); 
                                
                                // 如果有重复 (如 "日本 日本")，取第一个词
                                const parts = region.split(/\s+/);
                                if(parts.length > 0) region = parts[parts.length - 1]; // 取最后一个通常是中文名
                                
                                break; // 找到了就停止
                            }
                            parent = parent.parentElement; // 继续往上一层找
                        }
                    }
                    // ===========================================

                    // 去重
                    if (!results.find(r => r.username === username)) {
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
      }
      return results;
    });

    console.log(`4. 完成！抓取到 ${accounts.length} 个账号`);

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

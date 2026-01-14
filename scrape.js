const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

(async () => {
  console.log('1. 启动智能浏览器...');
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 强力伪装
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('2. 打开网页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000)); // 等待渲染

    console.log('3. 开始“视觉”提取...');
    const accounts = await page.evaluate(() => {
      const results = [];
      const processedUsers = new Set(); // 防止重复

      // 找到所有输入框作为定位锚点
      const inputs = document.querySelectorAll('input');

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const val = input.value;

        // 只有当输入框里有 @ 符号时，才认为是账号
        if (val && val.includes('@')) {
            const username = val;
            
            // 假设紧接着的下一个输入框是密码
            // 有些时候结构复杂，可能隔了一个，尝试向下找
            let password = "";
            if (inputs[i+1] && inputs[i+1].value) password = inputs[i+1].value;
            
            // 找到包裹这个账号的卡片 (向上找5层，保险起见)
            let card = input.closest('.card') || input.closest('div.bg-white') || input.parentElement.parentElement.parentElement;
            
            if (card && password && !processedUsers.has(username)) {
                
                // === 🔥 核心逻辑：不再找class，直接读取卡片里的所有文字 ===
                const fullText = card.innerText || "";
                
                // 按行分割，通常第一行就是 "日本 日本 ● 正常"
                const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
                
                let region = "未知";
                let status = "正常"; // 默认正常
                
                // 1. 在所有行里找包含“正常”或“异常”的那一行
                let headerLine = lines.find(line => line.includes('正常') || line.includes('异常'));
                
                // 如果没找到，就默认第一行是头部信息
                if (!headerLine && lines.length > 0) headerLine = lines[0];

                if (headerLine) {
                    // 2. 提取状态 (如果这行里有“异常”字样，就是异常，否则默认正常)
                    if (headerLine.includes('异常')) status = "异常";
                    else if (headerLine.includes('封禁')) status = "封禁";
                    else status = "正常";

                    // 3. 扣掉“正常”这两个字，扣掉圆点，剩下的就是地区！
                    // 例如："日本 日本 ● 正常" -> "日本 日本"
                    let cleanText = headerLine
                        .replace('正常', '')
                        .replace('异常', '')
                        .replace('封禁', '')
                        .replace(/[●•]/g, '') // 去掉圆点符号
                        .replace(/状态/g, '')
                        .trim();
                    
                    if (cleanText) {
                        region = cleanText;
                        
                        // 4. (优化) 解决 "日本 日本" 重复的问题
                        // 如果剩下的是 "JP 日本" 或 "日本 日本"，我们可以切分一下
                        const parts = region.split(/\s+/);
                        // 如果切分后发现两个词一样 (如 [日本, 日本])，只取一个
                        if (parts.length === 2 && parts[0] === parts[1]) {
                            region = parts[0];
                        }
                    }
                }

                // 加入结果
                results.push({
                    region,
                    status,
                    username,
                    password,
                    checkTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                });
                
                processedUsers.add(username); // 标记已处理
            }
        }
      }
      return results;
    });

    console.log(`4. 抓取成功！共提取到 ${accounts.length} 条数据`);

    // 写入文件
    fs.writeFileSync('data.json', JSON.stringify({
        updated_at: new Date().getTime(),
        data: accounts
    }, null, 2));

  } catch (error) {
    console.error('❌ 出错:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// 目标网址
const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

async function scrape() {
  try {
    console.log('1. 开始请求目标网站...');
    const { data } = await axios.get(TARGET_URL, {
      headers: {
        // 伪装成浏览器，防止被拦截
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000 // 10秒超时
    });

    console.log('2. 网页下载成功，开始解析...');
    const $ = cheerio.load(data);
    const accounts = [];

    // 根据常见结构查找所有卡片
    // 逻辑：寻找包含 "账号" 或 "密码" 字样的区域
    //以此定位每一个包含账号信息的卡片块
    $('.card, .panel, .list-group-item, div[class*="col-"]').each((i, el) => {
        const text = $(el).text();
        // 只有当这个块里同时包含 "账号" 和 "密码" 时，才认为它是有效数据卡片
        if(text.includes('账号') && text.includes('密码')) {
            
            // 提取地区（通常在 badge 或 span 里）
            let region = $(el).find('.badge, span[class*="flag"]').first().text().trim();
            // 提取状态
            let status = $(el).find('.badge-success, .text-success').text().trim() || '正常';
            
            // 提取输入框中的账号和密码
            const inputs = $(el).find('input');
            let username = '';
            let password = '';

            if (inputs.length >= 2) {
                username = inputs.eq(0).val(); // 第一个输入框通常是账号
                password = inputs.eq(1).val(); // 第二个输入框通常是密码
            } else {
                // 如果不是 input，尝试获取文本
                // 这里是备用逻辑，防止网页改版
                const lines = $(el).text().split('\n');
                lines.forEach(line => {
                    if(line.includes('@')) username = line.trim();
                });
            }

            // 过滤无效数据，只有当账号存在时才保存
            if (username && username.includes('@')) {
                // 去重逻辑：防止同一个卡片被多次解析
                const exists = accounts.find(a => a.username === username);
                if (!exists) {
                    accounts.push({
                        region: region || '未知',
                        status: status,
                        username: username,
                        password: password,
                        checkTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                    });
                }
            }
        }
    });

    console.log(`3. 解析完成，共提取到 ${accounts.length} 个账号。`);

    // 如果没有抓到数据，抛出错误警告（可在 GitHub Actions 日志中看到）
    if (accounts.length === 0) {
        console.warn('⚠️ 警告：未找到账号数据，可能是网站改版或选择器失效。');
    }

    // 保存文件
    const output = {
        updated_at: new Date().getTime(),
        data: accounts
    };
    
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log('4. 数据已保存至 data.json');

  } catch (error) {
    console.error('❌ 抓取失败:', error.message);
    process.exit(1); // 报错退出，让 GitHub 通知你
  }
}

scrape();

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const TARGET_URL = 'https://www.woko.pro/h/502/miemie';

async function scrape() {
  try {
    console.log('1. 正在伪装成 Chrome 浏览器发起请求...');
    
    const { data } = await axios.get(TARGET_URL, {
      headers: {
        // 【关键修复】添加全套浏览器标识，模拟真实用户
        'Host': 'www.woko.pro',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.woko.pro/',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0'
      },
      timeout: 20000 // 延长超时时间到20秒
    });

    console.log('2. 请求成功！开始解析数据...');
    const $ = cheerio.load(data);
    const accounts = [];

    // 针对您截图的卡片结构进行解析
    $('div').each((i, el) => {
        const text = $(el).text();
        // 必须同时包含“账号”和“密码”才处理
        if(text.includes('账号') && text.includes('密码') && $(el).find('input').length > 0) {
            
            // 提取地区
            let region = $(el).find('.badge, span[class*="flag"]').first().text().trim();
            region = region.replace(/\s+/g, ' ').split(' ')[0]; 

            // 提取状态
            let status = $(el).find('.text-success, .badge-success').text().trim() || '正常';

            // 提取输入框
            const inputs = $(el).find('input');
            let username = '';
            let password = '';
            
            inputs.each((idx, input) => {
                const val = $(input).val();
                if(val && val.includes('@')) username = val;
                else if(val && idx === 1) password = val;
            });

            // 兜底逻辑
            if(!username && inputs.eq(0).val()) username = inputs.eq(0).val();
            if(!password && inputs.eq(1).val()) password = inputs.eq(1).val();

            // 保存有效数据
            if (username && password) {
                // 简单去重
                if (!accounts.find(a => a.username === username)) {
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
    
    // 即使没抓到数据，也要生成一个空文件，防止报错
    const outputData = accounts.length > 0 ? accounts : [];
    
    fs.writeFileSync('data.json', JSON.stringify({
        updated_at: new Date().getTime(),
        data: outputData
    }, null, 2));

  } catch (error) {
    // 打印更详细的错误信息
    if (error.response) {
      console.error(`❌ 服务器拒绝: 状态码 ${error.response.status}`);
      console.error('错误详情:', error.response.data);
    } else {
      console.error('❌ 请求失败:', error.message);
    }
    process.exit(1);
  }
}

scrape();

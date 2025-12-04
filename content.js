// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'export_md') {
        exportMarkdown();
    } else if (request.action === 'export_pdf') {
        exportPDF();
    }
});

// ============================================
//  核心：数据提取 (保持不变)
// ============================================
function getChatHistory() {
    const turns = document.querySelectorAll('ms-chat-turn');
    const history = [];

    turns.forEach((turn) => {
        const container = turn.querySelector('.chat-turn-container');
        if (!container) return;

        let role = "Unknown";
        if (container.classList.contains('user')) role = "User";
        else if (container.classList.contains('model')) role = "Model";

        const contentContainer = turn.querySelector('.turn-content');
        if (!contentContainer) return;

        const clone = contentContainer.cloneNode(true);

        // 清洗垃圾
        clone.querySelectorAll('ms-thought-chunk').forEach(el => el.remove());
        const garbageSelectors = ['.actions-container', '.turn-footer', '.turn-separator', '.author-label', 'ms-tooltip', 'svg', '.citations-container'];
        garbageSelectors.forEach(s => clone.querySelectorAll(s).forEach(el => el.remove()));

        // 提取 MD
        const cleanMd = parseHtmlToMarkdown(clone);
        
        // 提取 HTML (PDF用)
        // 针对 PDF 的代码块样式微调，防止截图时文字溢出
        clone.querySelectorAll('pre').forEach(pre => {
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordWrap = 'break-word';
            pre.style.fontFamily = 'Consolas, Monaco, "Courier New", monospace';
        });

        if (cleanMd.trim()) {
            history.push({ role, html: clone.innerHTML, markdown: cleanMd });
        }

    });
    return history;
}

// ============================================
//  功能 1: Markdown 导出 (精准修复缩进)
// ============================================

// [核心算法]：基于第一行的基准去缩进
function strictDedent(text) {
    // 1. 拆分行，并去除末尾的空白字符（防止HTML多余空格）
    const lines = text.split('\n');
    
    // 2. 找到第一行有内容的行，计算它的前导空格数
    let baseIndentLength = -1;
    
    // 先移除开头纯空行
    while(lines.length > 0 && !lines[0].trim()) {
        lines.shift();
    }

    if (lines.length === 0) return "";

    // 获取第一行的缩进作为基准
    const firstLine = lines[0];
    const match = firstLine.match(/^[\t ]*/);
    if (match) {
        baseIndentLength = match[0].length;
    } else {
        baseIndentLength = 0;
    }

    // Remove the leading whitespace from the first line based on the base indent
    lines[0] = firstLine.substring(baseIndentLength);

    return lines.join('\n');
}

function parseHtmlToMarkdown(rootElement) {
    const el = rootElement.cloneNode(true);

    // 1. 代码块处理 (应用 Strict Dedent)
    el.querySelectorAll('pre').forEach(pre => {
        let lang = "";
        const codeNode = pre.querySelector('code');
        if (codeNode && codeNode.className) {
            lang = codeNode.className.replace(/language-/, '').split(' ')[0] || "";
        }
        
        // 获取纯文本
        let rawContent = pre.innerText;
        // 执行严格去缩进
        let finalCode = strictDedent(rawContent);

        // 拼接 MD
        pre.textContent = `\n\n\`\`\`${lang}\n${finalCode}\n\`\`\`\n\n`;
    });

    // 2. 其他元素转换 (同前)
    el.querySelectorAll('code').forEach(code => {
        if (code.parentElement.tagName !== 'PRE') code.textContent = `\`${code.innerText}\``;
    });
    el.querySelectorAll('li').forEach(li => li.textContent = `- ${li.innerText}\n`);
    el.querySelectorAll('strong, b').forEach(b => b.textContent = `**${b.innerText}**`);
    el.querySelectorAll('em, i').forEach(i => i.textContent = `*${i.innerText}*`);
    el.querySelectorAll('a').forEach(a => { if(a.href) a.textContent = `[${a.innerText}](${a.href})`; });
    el.querySelectorAll('p').forEach(p => p.replaceWith(`${p.innerText}\n\n`));
    el.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

    return el.innerText.replace(/\n{3,}/g, '\n\n').trim();
}

function exportMarkdown() {
    const history = getChatHistory();
    if (history.length === 0) return alert("未找到内容，请刷新页面。");

    let md = `# AI Studio 导出\n> 时间: ${new Date().toLocaleString()}\n\n---\n\n`;
    history.forEach(item => {
        if (item.role === 'User') {
            md += `### 🙋‍♂️ **User**\n\n${item.markdown.split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
        } else {
            md += `### 🤖 **AI Model**\n\n${item.markdown}\n\n---\n\n`;
        }
    });
    downloadFile(md, `Chat_${Date.now()}.md`, 'text/markdown');
}

// ============================================
//  功能 2: PDF 导出 (html2pdf 高清截图版)
// ============================================
async function exportPDF() {
    const history = getChatHistory();
    if (history.length === 0) return alert("无内容");

    // 检查库
    if (typeof html2pdf === 'undefined') return alert("请检查 manifest.json 是否包含 html2pdf.js");

    // 1. 覆盖层 (白底，防止透视)
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;z-index:99999;background:#fff;padding:40px;box-sizing:border-box;";
    
    // 2. 内容容器 (A4 宽度优化)
    const container = document.createElement('div');
    container.style.cssText = "max-width:780px;margin:0 auto;font-family:'Microsoft YaHei',sans-serif;color:#333;";
    
    container.innerHTML = `<h2 style="text-align:center;border-bottom:1px solid #eee;padding-bottom:15px;">AI Studio 记录</h2>`;
    
    history.forEach(item => {
        const isUser = item.role === 'User';
        const align = isUser ? 'flex-end' : 'flex-start';
        const bg = isUser ? '#f0f7ff' : '#fff';
        const border = isUser ? '1px solid #cce5ff' : 'none';
        // 代码块背景强制设为浅灰，防止截图时一片白
        const content = item.html.replace(/<pre/g, '<pre style="background:#f6f8fa;padding:10px;border-radius:5px;border:1px solid #eee;"');

        container.innerHTML += `
            <div style="display:flex;flex-direction:column;align-items:${align};margin-bottom:20px;">
                <div style="font-weight:bold;font-size:12px;margin-bottom:5px;color:${isUser?'#0057ff':'#d93025'}">${isUser?'User':'AI'}</div>
                <div style="background:${bg};border:${border};padding:12px 16px;border-radius:8px;max-width:100%;line-height:1.6;font-size:14px;">
                    ${content}
                </div>
            </div>
        `;
    });

    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // 3. 提示
    const tip = document.createElement('div');
    tip.innerText = "正在生成高清 PDF，请勿关闭...";
    tip.style.cssText = "position:fixed;top:20px;right:20px;background:rgba(0,0,0,0.7);color:#fff;padding:10px 20px;border-radius:4px;z-index:1000000;";
    document.body.appendChild(tip);

    // 4. 配置 (关键是 scale)
    const opt = {
        margin:       10,
        filename:     `AI_Studio_${Date.now()}.pdf`,
        image:        { type: 'jpeg', quality: 1 }, // 最高质量 JPG
        html2canvas:  { 
            scale: 3,       // [关键] 3倍缩放，解决模糊问题 (Retina 级别)
            useCORS: true,  // 允许跨域图片
            scrollY: 0      // 强制从顶部开始截取
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css'] }
    };

    try {
        await html2pdf().set(opt).from(container).save();
    } catch (e) {
        console.error(e);
        alert("导出失败");
    } finally {
        document.body.removeChild(overlay);
        document.body.removeChild(tip);
    }
}

function downloadFile(content, filename, contentType) {
    const a = document.createElement('a');
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
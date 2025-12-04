document.getElementById('btn-md').addEventListener('click', () => {
  sendMessage('export_md');
});

document.getElementById('btn-pdf').addEventListener('click', () => {
  sendMessage('export_pdf');
});

function sendMessage(action) {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {action: action});
    }
  });
}
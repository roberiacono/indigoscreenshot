chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Screenshot failed:', chrome.runtime.lastError.message);
        return;
      }
      
      // Store the image data and open the editor
      chrome.storage.local.set({ 'capturedScreenshot': dataUrl }, () => {
        chrome.tabs.create({ url: 'editor.html' });
      });
    });
  }
});

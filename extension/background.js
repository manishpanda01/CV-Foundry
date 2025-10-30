chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id:'cvfoundry-tailor', title:'Tailor my CV with Job Listing', contexts:['selection','page'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'cvfoundry-tailor') return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target:{ tabId: tab.id }, func: () => document.body.innerText.slice(0,20000) });
    chrome.storage.local.set({ lastJobText: result || '' });
    chrome.action.openPopup();
  } catch(e) { console.error(e); }
});
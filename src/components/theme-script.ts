export const THEME_KEY = "email-finder-theme";

// Runs in <head> before the first paint. Light unless the user chose dark.
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="dark")t="light";document.documentElement.dataset.theme=t;}catch(e){}})();`;

export const THEME_KEY = "email-finder-theme";

// Runs in <head> before the first paint. Dark unless the user chose light.
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light")t="dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

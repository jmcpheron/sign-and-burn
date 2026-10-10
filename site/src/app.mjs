// One script for both pages, so what they share is in the folder once: each page runs only its own
// part. wallet.html says which it is on its <html> element.
if (document.documentElement.dataset.page === "wallet") import("./wallet.mjs");
else import("./main.mjs");

// The bash editor runs in a full-screen frame over the main screen on Android
// (the Mac opens it in a window of its own). It shares the main screen's
// stores through its own API, and "closing the window" closes the layer.
window.soundboard = window.parent.DRApp.createApi(window);
window.close = () => window.parent.DRApp.editorClosed();
document.documentElement.classList.add('android');

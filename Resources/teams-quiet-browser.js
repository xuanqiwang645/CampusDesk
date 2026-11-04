/* macOS JXA only. Read Chromium windows and tabs without asking the browser
   to activate or request user attention on each Apple event. */
function createQuietTeamsBrowser(browser) {
  'use strict';
  ObjC.import('AppKit');
  ObjC.import('ScriptingBridge');
  var bundles = { chrome: 'com.google.Chrome', edge: 'com.microsoft.edgemac' };
  if (!Object.prototype.hasOwnProperty.call(bundles, browser)) throw new Error('Unknown Teams browser');
  var process = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundles[browser]).firstObject;
  var app = !process.isNil() && $.SBApplication.applicationWithProcessIdentifier(process.processIdentifier);
  // kAEWaitReply (0x03) | kAENeverInteract (0x10), without kAECanSwitchLayer.
  if (app && !app.isNil()) app.sendMode = 0x03 | 0x10;

  function running() { return Boolean(app && !app.isNil() && !process.terminated); }
  function failure(code, message, number) {
    var error = new Error(message);
    error.code = code; error.number = number;
    throw error;
  }
  function checkTarget() {
    if (!running()) failure('BROWSER_NOT_RUNNING', '所选浏览器已关闭。', -600);
  }
  function checked(object, value) {
    var error = object.lastError;
    if (error && !error.isNil()) {
      var number = Number(error.code);
      if (number === -1728) failure('TAB_MISSING', '同步窗口或标签已关闭。', number);
      if (number === -600) failure('BROWSER_NOT_RUNNING', '所选浏览器已关闭。', number);
      if (number === -1743) failure('AUTOMATION_DENIED', 'Not authorized to send Apple events (-1743)', number);
      // Cocoa scripting errors can include the submitted command. Never export it.
      var info = error.userInfo.objectForKey('ErrorString');
      var description = ObjC.unwrap(error.localizedDescription) + ' ' + (info.isNil() ? '' : ObjC.unwrap(info));
      if (/javascript.*(?:disabled|turned off|not allowed)|allow javascript from apple events|executing javascript through applescript/i.test(description)) {
        failure('JAVASCRIPT_DISABLED', 'JavaScript from Apple Events is disabled.', number);
      }
      failure('BROWSER_ERROR', '浏览器未能读取此标签。', number);
    }
    return value;
  }
  function property(object, key) {
    checkTarget();
    return checked(object, object.valueForKey(key));
  }
  function items(parent, key, wrap) {
    var elements = property(parent, key);
    // Resolve stable IDs in one event. Index specifiers could silently change
    // targets if the user closes or moves a tab between lookup and extraction.
    var ids = checked(parent, elements.arrayByApplyingSelector('id'));
    var result = [], count = Number(ids.count);
    for (var i = 0; i < count; i++) result.push(wrap(elements.objectWithID(ids.objectAtIndex(i))));
    return result;
  }
  function wrapTab(tab) {
    return {
      id: function () { return ObjC.unwrap(property(tab, 'id')); },
      url: function () { return ObjC.unwrap(property(tab, 'URL')); },
      title: function () { return ObjC.unwrap(property(tab, 'title')); },
      execute: function (request) {
        checkTarget();
        return ObjC.unwrap(checked(tab, tab.performSelectorWithObject('executeJavascript:', $(request.javascript))));
      }
    };
  }
  function wrapWindow(win) {
    return {
      id: function () { return ObjC.unwrap(property(win, 'id')); },
      activeTab: function () {
        var id = property(property(win, 'activeTab'), 'id');
        return wrapTab(property(win, 'tabs').objectWithID(id));
      },
      tabs: function () { return items(win, 'tabs', wrapTab); }
    };
  }
  return {
    running: running,
    windows: function () { return items(app, 'windows', wrapWindow); },
    tab: function (windowID, tabID) {
      var win = property(app, 'windows').objectWithID($(String(windowID)));
      return wrapTab(property(win, 'tabs').objectWithID($(String(tabID))));
    }
  };
}

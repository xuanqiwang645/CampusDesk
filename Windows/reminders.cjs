'use strict';
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {allowedURL} = require('../Resources/teams-auto-runner.js');
function desiredReminders(items, enabled, now = Date.now()) {
  if (!enabled || !Array.isArray(items)) return [];
  return items.slice(0, 60).filter(i => i && i.source === 'teams' && typeof i.id === 'string' && i.id.length <= 512 && allowedURL(i.url)
    && typeof i.title === 'string' && i.title && Date.parse(i.fireAt) > now && Date.parse(i.fireAt) - now <= 366 * 86400000)
    .map(i => ({id: crypto.createHash('sha256').update(JSON.stringify([i.id, i.fireAt, i.title, i.body, i.url])).digest('hex').slice(0, 16),
      title: 'Teams · ' + i.title.slice(0, 120), body: String(i.body || '作业即将截止，请查看要求。').slice(0, 240), url: i.url, fireAt: i.fireAt}));
}
class Reminders {
  constructor(options) { Object.assign(this, options); this.serial = Promise.resolve(); }
  sync(items, enabled) {
    const desired = desiredReminders(items, enabled), signature = JSON.stringify(desired);
    if (signature === this.signature) return;
    this.signature = signature;
    this.serial = this.serial.then(() => this.schedule(desired)).catch(() => { this.signature = ''; this.onError('Windows 未能安排系统提醒，请检查系统通知设置。'); });
  }
  schedule(items) {
    if (process.platform !== 'win32') return Promise.resolve();
    // All interpolated user text is encoded JSON data, never PowerShell syntax.
    const json = Buffer.from(JSON.stringify(items), 'utf8').toString('base64');
    const script = `$ErrorActionPreference='Stop'
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null
[Windows.UI.Notifications.ScheduledToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] > $null
$notifier=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('local.campusdesk.windows')
$items=@(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${json}'))))
$wanted=@{}; foreach($item in $items){$wanted[$item.id]=$true}
$existing=@{}; foreach($old in $notifier.GetScheduledToastNotifications()){if(!$wanted.ContainsKey($old.Id)){$notifier.RemoveFromSchedule($old)}else{$existing[$old.Id]=$true}}
foreach($item in $items){
 if($existing.ContainsKey($item.id)){continue}
 $time=[DateTimeOffset]::Parse($item.fireAt); if($time -le [DateTimeOffset]::Now){continue}
 $title=[Security.SecurityElement]::Escape($item.title); $body=[Security.SecurityElement]::Escape($item.body); $url=[Security.SecurityElement]::Escape($item.url)
 $xml=New-Object Windows.Data.Xml.Dom.XmlDocument
 $xml.LoadXml('<toast activationType="protocol" launch="'+$url+'"><visual><binding template="ToastGeneric"><text>'+$title+'</text><text>'+$body+'</text></binding></visual></toast>')
 $toast=[Windows.UI.Notifications.ScheduledToastNotification]::new($xml,$time);$toast.Id=$item.id;$notifier.AddToSchedule($toast)
}`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true, stdio: 'ignore'});
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Notification timeout')); }, 15000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Notification failed')); });
    });
  }
}
module.exports = {Reminders, desiredReminders};

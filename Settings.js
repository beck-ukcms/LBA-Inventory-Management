/**
 * Settings.js
 * Application configuration access.
 * Scope: Reads non-secret Settings values, builds public app configuration, and initializes required application settings.
 * Current as of v1.20.
 */
function getSettingsMap_() {
  const records = getRecords_('Settings');
  return Object.fromEntries(records.filter(r => r.Setting).map(r => [String(r.Setting), r.Value]));
}

function getPublicAppConfig_() {
  const s = getSettingsMap_();
  return {
    appName: s.App_Name || 'LBA Bingo Inventory Management',
    supportEmail: s.Support_Email || 'bingo@lafayetteband.org',
    links: [
      {id: 'pt', title: 'PT Processing', subtitle: 'Bundle and print pull-tab receipts', url: s.PT_Processing_App_URL || '', icon: s.PT_Processing_Icon_URL || ''},
      {id: 'paperwork', title: 'Paperwork Management', subtitle: 'Create, process, and archive session paperwork', url: s.Paperwork_Management_App_URL || '', icon: s.Paperwork_Management_Icon_URL || ''},
      {id: 'signin', title: 'Volunteer Sign-In', subtitle: 'Volunteer check-in and session staffing', url: s.Volunteer_SignIn_App_URL || '', icon: s.Volunteer_SignIn_Icon_URL || ''},
      {id: 'idscan', title: 'ID Scanning', subtitle: 'Scan and record patron IDs', url: s.ID_Scanning_App_URL || '', icon: s.ID_Scanning_Icon_URL || ''},
    ],
  };
}

function ensureApplicationSettings() {
  const required = [
    ['App_Name', 'LBA Bingo Inventory Management', 'Display name for the integrated web app.'],
    ['Support_Email', 'bingo@lafayetteband.org', 'Administrative support contact.'],
    ['PT_Processing_App_URL', 'https://script.google.com/macros/u/1/s/AKfycbz7Tcl0N9pmP_viE8Hulm4mZEHMt6PpEYKGaYPscoyKNomiVcteXkKLeQHoEeGA4bEO2w/exec', 'Existing PT Bundling Receipt Printer web app.'],
    ['PT_Processing_Icon_URL', 'https://lafayettebandbingo.org/wp-content/uploads/2026/11/bingo_pt-bundling_icon.png', 'PT Processing tile icon.'],
    ['Volunteer_SignIn_App_URL', 'https://script.google.com/macros/s/AKfycbwSVvhgiz6AbRvrIUyeV8yzTMc3cVhECJJIZJbz5x3TEqFZTBczHIM5wtGQZ2E_ezvTEw/exec', 'Volunteer Sign-In web app.'],
    ['Volunteer_SignIn_Icon_URL', 'https://lafayettebandbingo.org/wp-content/uploads/2026/11/bingo_signin_icon.png', 'Volunteer Sign-In tile icon.'],
    ['ID_Scanning_App_URL', 'https://script.google.com/macros/s/AKfycby7Z03AMY5U-Jvh5KRQZG_aMPFXIWr4KsSNMk_fFpFfyyXLTegX74vzeD-RU6oW70pDiw/exec', 'ID Scanning web app.'],
    ['ID_Scanning_Icon_URL', 'https://lafayettebandbingo.org/wp-content/uploads/2026/11/bingo_id-scanner_icon.png', 'ID Scanner tile icon.'],
    ['Paperwork_Management_App_URL', 'https://script.google.com/macros/s/AKfycbwYNMGb1Z05p77lYhsU-dR55q23A-doFZVkWMNyICjG3q4UsjWI5wGJ_eH2Ur9cI9fnVQ/exec', 'Paperwork Management web app.'],
    ['Paperwork_Management_Icon_URL', 'https://lafayettebandbingo.org/wp-content/uploads/2026/11/bingo_paperwork_icon.png', 'Paperwork Management tile icon.'],
  ];
  const existing = new Set(getRecords_('Settings').map(r => String(r.Setting)));
  required.filter(row => !existing.has(row[0])).forEach(row => appendRecord_('Settings', {Setting: row[0], Value: row[1], Description: row[2]}));
  return {added: required.filter(row => !existing.has(row[0])).map(row => row[0])};
}

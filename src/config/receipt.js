// Receipt printer settings. Edit, then rebuild/redeploy for the POS to pick them up.
export const RECEIPT = {
  storeName: 'Demo Fitness',
  // Up to 3 lines under the store name, e.g. address, phone, website. Leave '' to skip a line.
  headerLines: ['', '', ''],
  footerLines: ['Thank you!'],
  paperWidth: 58, // 58 or 80 (mm), match the roll in the Xprinter (XP-58IIH = 58)
  helperUrl: 'http://127.0.0.1:9123', // receipt helper on the front desk PC (public/helper/receipt-helper.ps1)
  autoPrint: false, // true = print as soon as a sale is saved, without pressing Print receipt
}

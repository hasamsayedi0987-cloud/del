/**
 * فهرست کشورها برای انتخاب پیش‌شماره در صفحهٔ ورود
 * — همهٔ کشورها با کد بین‌المللی (ITU-T E.164)، نام فارسی و پرچم
 * پرچم‌ها از کد ISO 3166-1 alpha-2 ساخته می‌شوند (Regional Indicator Symbols)
 */

export interface Country {
  /** کد ISO دوحرفی */
  cc: string;
  /** کد بین‌المللی بدون + */
  dial: string;
  /** نام فارسی */
  name: string;
}

/** ساخت ایموجی پرچم از کد ISO */
export function flagOf(cc: string): string {
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/**
 * کشورهای پرطرفدار در ابتدای فهرست (ایران، ترکیه، افغانستان، …)
 */
export const POPULAR_CC = ['IR', 'TR', 'AF', 'IQ', 'AE', 'DE', 'US', 'CA', 'GB', 'SE', 'NL', 'AT'];

/**
 * همهٔ کشورها — کد ISO، کد بین‌المللی، نام فارسی
 */
export const COUNTRIES: Country[] = [
  { cc: 'IR', dial: '98', name: 'ایران' },
  { cc: 'TR', dial: '90', name: 'ترکیه' },
  { cc: 'AF', dial: '93', name: 'افغانستان' },
  { cc: 'IQ', dial: '964', name: 'عراق' },
  { cc: 'AE', dial: '971', name: 'امارات متحدهٔ عربی' },
  { cc: 'DE', dial: '49', name: 'آلمان' },
  { cc: 'US', dial: '1', name: 'آمریکا' },
  { cc: 'CA', dial: '1', name: 'کانادا' },
  { cc: 'GB', dial: '44', name: 'بریتانیا' },
  { cc: 'SE', dial: '46', name: 'سوئد' },
  { cc: 'NL', dial: '31', name: 'هلند' },
  { cc: 'AT', dial: '43', name: 'اتریش' },
  { cc: 'AZ', dial: '994', name: 'آذربایجان' },
  { cc: 'AM', dial: '374', name: 'ارمنستان' },
  { cc: 'TM', dial: '993', name: 'ترکمنستان' },
  { cc: 'TJ', dial: '992', name: 'تاجیکستان' },
  { cc: 'UZ', dial: '998', name: 'ازبکستان' },
  { cc: 'PK', dial: '92', name: 'پاکستان' },
  { cc: 'SA', dial: '966', name: 'عربستان سعودی' },
  { cc: 'QA', dial: '974', name: 'قطر' },
  { cc: 'KW', dial: '965', name: 'کویت' },
  { cc: 'BH', dial: '973', name: 'بحرین' },
  { cc: 'OM', dial: '968', name: 'عمان' },
  { cc: 'SY', dial: '963', name: 'سوریه' },
  { cc: 'LB', dial: '961', name: 'لبنان' },
  { cc: 'JO', dial: '962', name: 'اردن' },
  { cc: 'IL', dial: '972', name: 'اسرائیل' },
  { cc: 'PS', dial: '970', name: 'فلسطین' },
  { cc: 'YE', dial: '967', name: 'یمن' },
  { cc: 'EG', dial: '20', name: 'مصر' },
  { cc: 'DZ', dial: '213', name: 'الجزایر' },
  { cc: 'MA', dial: '212', name: 'مراکش' },
  { cc: 'TN', dial: '216', name: 'تونس' },
  { cc: 'LY', dial: '218', name: 'لیبی' },
  { cc: 'SD', dial: '249', name: 'سودان' },
  { cc: 'SS', dial: '211', name: 'سودان جنوبی' },
  { cc: 'ET', dial: '251', name: 'اتیوپی' },
  { cc: 'SO', dial: '252', name: 'سومالی' },
  { cc: 'KE', dial: '254', name: 'کنیا' },
  { cc: 'TZ', dial: '255', name: 'تانزانیا' },
  { cc: 'UG', dial: '256', name: 'اوگاندا' },
  { cc: 'RW', dial: '250', name: 'رواندا' },
  { cc: 'NG', dial: '234', name: 'نیجریه' },
  { cc: 'GH', dial: '233', name: 'غنا' },
  { cc: 'SN', dial: '221', name: 'سنگال' },
  { cc: 'CI', dial: '225', name: 'ساحل عاج' },
  { cc: 'CM', dial: '237', name: 'کامرون' },
  { cc: 'ZA', dial: '27', name: 'آفریقای جنوبی' },
  { cc: 'FR', dial: '33', name: 'فرانسه' },
  { cc: 'IT', dial: '39', name: 'ایتالیا' },
  { cc: 'ES', dial: '34', name: 'اسپانیا' },
  { cc: 'PT', dial: '351', name: 'پرتغال' },
  { cc: 'BE', dial: '32', name: 'بلژیک' },
  { cc: 'CH', dial: '41', name: 'سوئیس' },
  { cc: 'DK', dial: '45', name: 'دانمارک' },
  { cc: 'NO', dial: '47', name: 'نروژ' },
  { cc: 'FI', dial: '358', name: 'فنلاند' },
  { cc: 'IS', dial: '354', name: 'ایسلند' },
  { cc: 'IE', dial: '353', name: 'ایرلند' },
  { cc: 'PL', dial: '48', name: 'لهستان' },
  { cc: 'CZ', dial: '420', name: 'چک' },
  { cc: 'SK', dial: '421', name: 'اسلواکی' },
  { cc: 'HU', dial: '36', name: 'مجارستان' },
  { cc: 'RO', dial: '40', name: 'رومانی' },
  { cc: 'BG', dial: '359', name: 'بلغارستان' },
  { cc: 'GR', dial: '30', name: 'یونان' },
  { cc: 'HR', dial: '385', name: 'کرواسی' },
  { cc: 'RS', dial: '381', name: 'صربستان' },
  { cc: 'BA', dial: '387', name: 'بوسنی و هرزگوین' },
  { cc: 'MK', dial: '389', name: 'مقدونیهٔ شمالی' },
  { cc: 'AL', dial: '355', name: 'آلبانی' },
  { cc: 'ME', dial: '382', name: 'مونته‌نگرو' },
  { cc: 'SI', dial: '386', name: 'اسلوونی' },
  { cc: 'UA', dial: '380', name: 'اوکراین' },
  { cc: 'BY', dial: '375', name: 'بلاروس' },
  { cc: 'MD', dial: '373', name: 'مولداوی' },
  { cc: 'LT', dial: '370', name: 'لیتوانی' },
  { cc: 'LV', dial: '371', name: 'لتونی' },
  { cc: 'EE', dial: '372', name: 'استونی' },
  { cc: 'GE', dial: '995', name: 'گرجستان' },
  { cc: 'RU', dial: '7', name: 'روسیه' },
  { cc: 'KZ', dial: '7', name: 'قزاقستان' },
  { cc: 'CN', dial: '86', name: 'چین' },
  { cc: 'JP', dial: '81', name: 'ژاپن' },
  { cc: 'KR', dial: '82', name: 'کرهٔ جنوبی' },
  { cc: 'KP', dial: '850', name: 'کرهٔ شمالی' },
  { cc: 'IN', dial: '91', name: 'هند' },
  { cc: 'BD', dial: '880', name: 'بنگلادش' },
  { cc: 'LK', dial: '94', name: 'سری‌لانکا' },
  { cc: 'NP', dial: '977', name: 'نپال' },
  { cc: 'BT', dial: '975', name: 'بوتان' },
  { cc: 'MV', dial: '960', name: 'مالدیو' },
  { cc: 'MM', dial: '95', name: 'میانمار' },
  { cc: 'TH', dial: '66', name: 'تایلند' },
  { cc: 'VN', dial: '84', name: 'ویتنام' },
  { cc: 'LA', dial: '856', name: 'لائوس' },
  { cc: 'KH', dial: '855', name: 'کامبوج' },
  { cc: 'MY', dial: '60', name: 'مالزی' },
  { cc: 'SG', dial: '65', name: 'سنگاپور' },
  { cc: 'ID', dial: '62', name: 'اندونزی' },
  { cc: 'PH', dial: '63', name: 'فیلیپین' },
  { cc: 'BN', dial: '673', name: 'برونئی' },
  { cc: 'MN', dial: '976', name: 'مغولستان' },
  { cc: 'HK', dial: '852', name: 'هنگ‌کنگ' },
  { cc: 'MO', dial: '853', name: 'ماکائو' },
  { cc: 'TW', dial: '886', name: 'تایوان' },
  { cc: 'AU', dial: '61', name: 'استرالیا' },
  { cc: 'NZ', dial: '64', name: 'نیوزیلند' },
  { cc: 'FJ', dial: '679', name: 'فیجی' },
  { cc: 'PG', dial: '675', name: 'پاپوآ گینهٔ نو' },
  { cc: 'BR', dial: '55', name: 'برزیل' },
  { cc: 'AR', dial: '54', name: 'آرژانتین' },
  { cc: 'CL', dial: '56', name: 'شیلی' },
  { cc: 'CO', dial: '57', name: 'کلمبیا' },
  { cc: 'PE', dial: '51', name: 'پرو' },
  { cc: 'VE', dial: '58', name: 'ونزوئلا' },
  { cc: 'EC', dial: '593', name: 'اکوادور' },
  { cc: 'BO', dial: '591', name: 'بولیوی' },
  { cc: 'PY', dial: '595', name: 'پاراگوئه' },
  { cc: 'UY', dial: '598', name: 'اروگوئه' },
  { cc: 'MX', dial: '52', name: 'مکزیک' },
  { cc: 'CU', dial: '53', name: 'کوبا' },
  { cc: 'GT', dial: '502', name: 'گواتمالا' },
  { cc: 'HN', dial: '504', name: 'هندوراس' },
  { cc: 'SV', dial: '503', name: 'السالوادور' },
  { cc: 'NI', dial: '505', name: 'نیکاراگوئه' },
  { cc: 'CR', dial: '506', name: 'کاستاریکا' },
  { cc: 'PA', dial: '507', name: 'پاناما' },
  { cc: 'DO', dial: '1', name: 'جمهوری دومینیکن' },
  { cc: 'JM', dial: '1', name: 'جامائیکا' },
  { cc: 'TT', dial: '1', name: 'ترینیداد و توباگو' },
  { cc: 'HT', dial: '509', name: 'هائیتی' },
  { cc: 'BZ', dial: '501', name: 'بلیز' },
  { cc: 'BS', dial: '1', name: 'باهاما' },
  { cc: 'AO', dial: '244', name: 'آنگولا' },
  { cc: 'MZ', dial: '258', name: 'موزامبیک' },
  { cc: 'ZM', dial: '260', name: 'زامبیا' },
  { cc: 'ZW', dial: '263', name: 'زیمبابوه' },
  { cc: 'BW', dial: '267', name: 'بوتسوانا' },
  { cc: 'NA', dial: '264', name: 'نامیبیا' },
  { cc: 'MG', dial: '261', name: 'ماداگاسکار' },
  { cc: 'MU', dial: '230', name: 'موریس' },
  { cc: 'SC', dial: '248', name: 'سیشل' },
  { cc: 'KM', dial: '269', name: 'کومور' },
  { cc: 'DJ', dial: '253', name: 'جیبوتی' },
  { cc: 'ER', dial: '291', name: 'اریتره' },
  { cc: 'MR', dial: '222', name: 'موریتانی' },
  { cc: 'ML', dial: '223', name: 'مالی' },
  { cc: 'NE', dial: '227', name: 'نیجر' },
  { cc: 'TD', dial: '235', name: 'چاد' },
  { cc: 'BF', dial: '226', name: 'بورکینافاسو' },
  { cc: 'BJ', dial: '229', name: 'بنین' },
  { cc: 'TG', dial: '228', name: 'توگو' },
  { cc: 'GN', dial: '224', name: 'گینه' },
  { cc: 'GM', dial: '220', name: 'گامبیا' },
  { cc: 'SL', dial: '232', name: 'سیرالئون' },
  { cc: 'LR', dial: '231', name: 'لیبریا' },
  { cc: 'GA', dial: '241', name: 'گابن' },
  { cc: 'CG', dial: '242', name: 'کنگو' },
  { cc: 'CD', dial: '243', name: 'کنگو (کینشاسا)' },
  { cc: 'CF', dial: '236', name: 'آفریقای مرکزی' },
  { cc: 'BI', dial: '257', name: 'بوروندی' },
  { cc: 'MW', dial: '265', name: 'مالاوی' },
  { cc: 'LS', dial: '266', name: 'لسوتو' },
  { cc: 'SZ', dial: '268', name: 'اسواتینی' },
  { cc: 'CV', dial: '238', name: 'کیپ‌ورد' },
  { cc: 'GQ', dial: '240', name: 'گینهٔ استوایی' },
  { cc: 'AD', dial: '376', name: 'آندورا' },
  { cc: 'LI', dial: '423', name: 'لیختن‌اشتاین' },
  { cc: 'MC', dial: '377', name: 'موناکو' },
  { cc: 'SM', dial: '378', name: 'سان‌مارینو' },
  { cc: 'VA', dial: '379', name: 'واتیکان' },
  { cc: 'MT', dial: '356', name: 'مالت' },
  { cc: 'CY', dial: '357', name: 'قبرس' },
  { cc: 'LU', dial: '352', name: 'لوکزامبورگ' },
  { cc: 'FO', dial: '298', name: 'جزایر فارو' },
  { cc: 'GI', dial: '350', name: 'جبل‌الطارق' },
];

/** تبدیل ارقام فارسی/عربی به لاتین — برای ورودی کاربر */
export function toLatinDigits(input: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  let out = '';
  for (const ch of input) {
    const f = fa.indexOf(ch);
    if (f > -1) {
      out += String(f);
      continue;
    }
    const a = ar.indexOf(ch);
    if (a > -1) {
      out += String(a);
      continue;
    }
    out += ch;
  }
  return out;
}

/** کشور پیش‌فرض — ایران */
export const DEFAULT_COUNTRY: Country = COUNTRIES.find((c) => c.cc === 'IR')!;

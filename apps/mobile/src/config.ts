import { Platform } from 'react-native';

/**
 * آدرس سرور API:
 *  • شبیه‌ساز اندروید  → http://10.0.2.2:3000  (10.0.2.2 = localhost کامپیوتر)
 *  • شبیه‌ساز iOS      → http://localhost:3000
 *  • گوشی واقعی        → http://<IP-local-network کامپیوتر>:3000  مثلاً http://192.168.1.5:3000
 *  • پروداکشن          → آدرس سرور واقعی
 */
export const API_BASE_URL = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
  : 'https://api.del.example.com';

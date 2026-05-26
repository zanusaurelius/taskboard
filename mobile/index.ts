// Install native crypto polyfill before anything else — required for AES-GCM / PBKDF2
import { install } from 'react-native-quick-crypto';
install();

import 'expo-router/entry';

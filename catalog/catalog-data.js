// Use the project URL and a public publishable (or legacy anon) key from Supabase.
export const SUPABASE_URL = 'https://vvwsenwbjhmagwigtfqs.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_zXO4GY-2ou6HpvEWzeaO9Q_XT7uJkDg';

// The cover bucket is shared by the catalog and homepage.
export const BUCKET = 'stl-models';
export const loadSupabase = () => import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm');

// Add public STL entries here. Version the file URL when replacing an existing STL.
export const publishedModels = [
  {
    id: 'ribbed-vase', category: 'Для дома и быта',
    fileUrl: 'assets/ribbed-vase.stl',
    title: 'Рельефная ваза',
    description: 'Мягкий силуэт и ритм вертикальных рёбер для сухоцветов.',
    color: '#a87a55',
    placeholder: 'assets/ribbed-vase.webp',
    dimensions: [77.8, 77.8, 105.2]
  },
  {
    id: 'phone-stand', category: 'Органайзеры',
    fileUrl: 'assets/phone-stand.stl',
    title: 'Подставка для телефона',
    description: 'Наклонная опора с нижним упором для рабочего стола.',
    color: '#426487',
    placeholder: 'assets/phone-stand.webp',
    dimensions: [76, 99, 85.4]
  },
  {
    id: 'hex-organizer', category: 'Органайзеры',
    fileUrl: 'assets/hex-organizer.stl',
    title: 'Шестигранный органайзер',
    description: 'Открытый лоток для ключей, крепежа и мелочей.',
    color: '#677047',
    placeholder: 'assets/hex-organizer.webp',
    dimensions: [116.8, 101.9, 44.8]
  }
];


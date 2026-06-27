import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ASSOCIATE_TAG = 'kodeal-20';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = {
  'Beauty & Personal Care': '뷰티',
  'Clothing': '패션',
  'Shoes': '패션',
  'Grocery': '마트',
  'Food': '마트',
  'Electronics': '테크',
  'Home & Kitchen': '리빙',
  'Tools': '리빙',
};

function getCategory(breadcrumb) {
  for (const [key, val] of Object.entries(CATEGORIES)) {
    if (breadcrumb?.includes(key)) return val;
  }
  return '특가';
}

async function fetchDeals() {
  console.log('🔍 아마존 딜 페이지 스크래핑 시작...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    const res = await fetch('https://www.amazon.com/deals?deals-widget=%7B%22version%22%3A1%2C%22viewIndex%22%3A0%2C%22presetId%22%3A%22deals-collection-all-deals%22%2C%22sorting%22%3A%22BY_SCORE%22%7D', { headers });
    
    if (!res.ok) {
      console.log(`❌ HTTP 오류: ${res.status}`);
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const deals = [];

    // 딜 카드 파싱
    $('[data-testid="deal-card"], .DealCard, [class*="dealCard"]').each((i, el) => {
      try {
        const title = $(el).find('[class*="title"], h2, h3').first().text().trim();
        const discountText = $(el).find('[class*="discount"], [class*="savings"], [class*="badge"]').first().text().trim();
        const priceText = $(el).find('[class*="price"], .a-price').first().text().trim();
        const originalPriceText = $(el).find('[class*="original"], .a-text-strike, s').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src');

        if (!title || !link) return;

        // 할인율 파싱
        const discountMatch = discountText.match(/(\d+)%/);
        const discount = discountMatch ? parseInt(discountMatch[1]) : 0;

        if (discount < 30) return;

        // 가격 파싱
        const priceMatch = priceText.match(/[\d.]+/);
        const price = priceMatch ? parseFloat(priceMatch[0]) : null;

        const originalMatch = originalPriceText.match(/[\d.]+/);
        const original = originalMatch ? parseFloat(originalMatch[0]) : null;

        if (!price) return;

        // 링크 정리
        const asinMatch = link.match(/\/dp\/([A-Z0-9]{10})/);
        const cleanLink = asinMatch 
          ? `https://www.amazon.com/dp/${asinMatch[1]}?tag=${ASSOCIATE_TAG}`
          : `https://www.amazon.com${link}&tag=${ASSOCIATE_TAG}`;

        deals.push({
          title: title.slice(0, 100),
          cat: '특가',
          store: 'Amazon',
          price,
          original,
          link: cleanLink,
          img: img || null,
        });

      } catch (e) {
        // 파싱 오류 무시
      }
    });

    console.log(`✅ ${deals.length}개 딜 파싱됨`);
    return deals;

  } catch (err) {
    console.log('❌ 스크래핑 실패:', err.message);
    return [];
  }
}

async function saveDeal(deal) {
  // 이미 같은 링크가 있는지 확인
  const { data: existing } = await sb
    .from('deals')
    .select('id')
    .eq('link', deal.link)
    .single();

  if (existing) {
    console.log(`⏭️ 이미 존재: ${deal.title.slice(0, 30)}...`);
    return false;
  }

  const { error } = await sb.from('deals').insert([deal]);
  if (error) {
    console.log(`❌ 저장 실패: ${error.message}`);
    return false;
  }

  console.log(`✅ 저장됨: ${deal.title.slice(0, 40)}...`);
  return true;
}

async function main() {
  console.log('🚀 KoDeal 자동화 시작:', new Date().toLocaleString('ko-KR'));
  
  const deals = await fetchDeals();
  
  if (deals.length === 0) {
    console.log('😅 가져온 딜이 없어요. 아마존이 막았을 수 있어요.');
    return;
  }

  let saved = 0;
  for (const deal of deals) {
    const ok = await saveDeal(deal);
    if (ok) saved++;
  }

  console.log(`🎉 완료! ${saved}개 새 딜 등록됨`);
}

main();

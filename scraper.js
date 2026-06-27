import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ASSOCIATE_TAG = 'kodeal-20';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Slickdeals RSS 피드 목록 (카테고리별)
const RSS_FEEDS = [
  { url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&deal_type=0&forumid[]=9&forumid[]=44&forumid[]=25&rss=1', cat: '뷰티' },
  { url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&deal_type=0&forumid[]=30&forumid[]=47&rss=1', cat: '패션' },
  { url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&deal_type=0&forumid[]=55&forumid[]=15&rss=1', cat: '마트' },
  { url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&deal_type=0&forumid[]=4&forumid[]=22&rss=1', cat: '테크' },
  { url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&deal_type=0&forumid[]=53&forumid[]=19&rss=1', cat: '리빙' },
];

// 할인율 파싱
function parseDiscount(text) {
  const match = text?.match(/(\d+)%\s*off/i);
  return match ? parseInt(match[1]) : 0;
}

// 가격 파싱
function parsePrice(text) {
  const match = text?.match(/\$(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

// 아마존 링크면 어필리에이트 태그 추가
function makeAffiliateLink(url) {
  if (!url) return url;
  if (url.includes('amazon.com')) {
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
    if (asinMatch) {
      return `https://www.amazon.com/dp/${asinMatch[1]}?tag=${ASSOCIATE_TAG}`;
    }
    try {
      const u = new URL(url);
      u.searchParams.set('tag', ASSOCIATE_TAG);
      return u.toString();
    } catch { return url; }
  }
  return url;
}

// RSS 파싱
async function fetchRSS(feedUrl, cat) {
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const deals = [];

    // item 태그 파싱
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const item of items) {
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
        || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
      
      const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
        || item.match(/<description>(.*?)<\/description>/)?.[1] || '';
      
      const link = item.match(/<link>(.*?)<\/link>/)?.[1]
        || item.match(/<guid>(.*?)<\/guid>/)?.[1] || '';

      if (!title || !link) continue;

      const fullText = title + ' ' + description;
      const discount = parseDiscount(fullText);
      const price = parsePrice(fullText);

      // 30% 미만 필터링
      if (discount > 0 && discount < 30) continue;

      // 이미지 추출
      const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
      const img = imgMatch ? imgMatch[1] : null;

      // 원가 추출
      const prices = fullText.match(/\$(\d+(?:\.\d+)?)/g);
      const original = prices && prices.length > 1 
        ? parseFloat(prices[prices.length - 1].replace('$', ''))
        : null;

      deals.push({
        title: title.slice(0, 100),
        cat,
        store: link.includes('amazon.com') ? 'Amazon' : 'Slickdeals',
        price: price || 0,
        original,
        link: makeAffiliateLink(link),
        img,
      });
    }

    return deals;
  } catch (err) {
    console.log(`❌ RSS 오류 (${cat}):`, err.message);
    return [];
  }
}

async function saveDeal(deal) {
  // 이미 같은 제목이 있는지 확인
  const { data: existing } = await sb
    .from('deals')
    .select('id')
    .eq('title', deal.title)
    .maybeSingle();

  if (existing) {
    console.log(`⏭️ 중복: ${deal.title.slice(0, 40)}...`);
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

  let allDeals = [];

  for (const feed of RSS_FEEDS) {
    console.log(`📡 ${feed.cat} 피드 가져오는 중...`);
    const deals = await fetchRSS(feed.url, feed.cat);
    console.log(`  → ${deals.length}개 딜 발견`);
    allDeals = allDeals.concat(deals);
  }

  console.log(`\n📦 총 ${allDeals.length}개 딜 처리 시작`);

  let saved = 0;
  for (const deal of allDeals) {
    const ok = await saveDeal(deal);
    if (ok) saved++;
  }

  console.log(`\n🎉 완료! ${saved}개 새 딜 등록됨`);
}

main();

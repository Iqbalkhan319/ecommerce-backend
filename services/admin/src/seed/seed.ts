import { randomUUID } from 'node:crypto';
import { createKnex } from '@ecom/platform';
import { loadEnv } from '../config/env';
import '../database/tables';

const CATEGORIES = [
  { slug: 'audio', name: 'Audio', description: 'Headphones, speakers and everything that makes a room sound better', position: 1 },
  { slug: 'workspace', name: 'Workspace', description: 'Desk equipment for people who work with their hands and their eyes', position: 2 },
  { slug: 'travel', name: 'Travel', description: 'Bags and accessories built for moving between places', position: 3 },
  { slug: 'lighting', name: 'Lighting', description: 'Lamps and fixtures with a considered warmth', position: 4 },
];

const PRODUCTS = [
  {
    sku: 'AUR-HDP-001', slug: 'studio-reference-headphones', name: 'Studio Reference Headphones',
    category: 'audio', price: 28900, compareAtPrice: 34900, stock: 42, cost: 16000,
    shortDescription: 'Closed-back monitoring headphones with a flat, honest response.',
    description: 'A reference pair tuned for long sessions: a flat response, replaceable ear pads and a detachable braided cable. Folds into a rigid case for travel.',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
  },
  {
    sku: 'AUR-SPK-002', slug: 'shelf-speaker-pair', name: 'Shelf Speaker Pair',
    category: 'audio', price: 49900, stock: 18, cost: 28500,
    shortDescription: 'Two-way bookshelf speakers in solid ash.',
    description: 'A compact two-way design in a solid ash cabinet. Front-ported, so they sit comfortably close to a wall without losing definition.',
    image: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800&q=80',
  },
  {
    sku: 'AUR-AUD-003', slug: 'noise-cancelling-headphones', name: 'Noise Cancelling Headphones',
    category: 'audio', price: 25400, stock: 4, lowStockThreshold: 5, cost: 14000,
    shortDescription: 'Over-ear headphones with adaptive noise cancelling.',
    description: 'Adaptive cancelling that reads the room and adjusts, with a transparency mode on a physical switch rather than buried in an app. Thirty hours to a charge.',
    image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&q=80',
  },
  {
    sku: 'AUR-HDP-004', slug: 'vintage-steel-headphones', name: 'Vintage Steel Headphones',
    category: 'audio', price: 20900, compareAtPrice: 24500, stock: 23, cost: 11100,
    shortDescription: 'Brushed steel on-ear headphones with a tan leather band.',
    description: 'Brushed steel cups on a tan leather headband, wired with a fabric-sleeved cable. Warm through the midrange, and built to be re-padded rather than replaced.',
    image: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80',
  },
  {
    sku: 'AUR-EAR-005', slug: 'wireless-earbuds-pro', name: 'Wireless Earbuds Pro',
    category: 'audio', price: 21900, stock: 65, cost: 11400,
    shortDescription: 'Sealed earbuds with a pocket charging case.',
    description: 'Four hours to a charge and twenty more in the case. Three silicone tip sizes in the box, so the seal that makes them sound right is actually achievable.',
    image: 'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=800&q=80',
  },
  {
    sku: 'AUR-EAR-006', slug: 'stage-monitor-earbuds', name: 'Stage Monitor Earbuds',
    category: 'audio', price: 16200, stock: 31, cost: 8600,
    shortDescription: 'Low-latency earbuds for monitoring and practice.',
    description: 'Latency low enough to play to, with a wired fallback for when a stage will not tolerate anything else. Ships in a hard shell case.',
    image: 'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=800&q=80',
  },
  {
    sku: 'AUR-SPK-007', slug: 'portable-bluetooth-speaker', name: 'Portable Bluetooth Speaker',
    category: 'audio', price: 13900, stock: 58, cost: 7100,
    shortDescription: 'Weatherproof speaker with twelve hours of playback.',
    description: 'Rated for rain and dust, with a passive radiator at each end that gives it more low end than its size suggests. Twelve hours at a sensible volume.',
    image: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800&q=80',
  },
  {
    sku: 'AUR-SPK-008', slug: 'voice-assistant-speaker', name: 'Voice Assistant Speaker',
    category: 'audio', price: 10400, stock: 47, cost: 5100,
    shortDescription: 'Fabric-wrapped smart speaker with a microphone switch.',
    description: 'A far-field microphone array with a hardware mute that physically breaks the circuit, so the light being off means something. Fabric in three shades.',
    image: 'https://images.unsplash.com/photo-1519558260268-cde7e03a0152?w=800&q=80',
  },
  {
    sku: 'AUR-DSK-010', slug: 'standing-desk-riser', name: 'Standing Desk Riser',
    category: 'workspace', price: 21900, stock: 27, cost: 12100,
    shortDescription: 'Gas-assisted riser that converts any desk to standing height.',
    description: 'Lifts a monitor, keyboard and notebook in one motion. Twelve locking heights, and a footprint that leaves room for everything already on the desk.',
    image: 'https://images.unsplash.com/photo-1611269154421-4e27233ac5c7?w=800&q=80',
  },
  {
    sku: 'AUR-KBD-011', slug: 'low-profile-keyboard', name: 'Low Profile Keyboard',
    category: 'workspace', price: 14900, compareAtPrice: 18500, stock: 63, cost: 8200,
    shortDescription: 'Seventy-five percent layout with hot-swappable switches.',
    description: 'A 75% board with a machined aluminium case, hot-swappable low-profile switches and a gasket mount that takes the edge off a long day of typing.',
    image: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80',
  },
  {
    sku: 'AUR-CHR-012', slug: 'task-chair', name: 'Task Chair',
    category: 'workspace', price: 74500, stock: 8, lowStockThreshold: 10, cost: 43200,
    shortDescription: 'Task chair with a twelve-year warranty.',
    description: 'Adjustable in every axis that matters, with a breathable back and a warranty long enough to make the price make sense.',
    image: 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?w=800&q=80',
  },
  {
    sku: 'AUR-MSE-013', slug: 'precision-wireless-mouse', name: 'Precision Wireless Mouse',
    category: 'workspace', price: 9200, stock: 84, cost: 4400,
    shortDescription: 'Low-latency mouse with a silent scroll wheel.',
    description: 'A shape that suits a palm grip, a scroll wheel with no click and a receiver that hides in the base for travel. Charges over the same cable as everything else.',
    image: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=800&q=80',
  },
  {
    sku: 'AUR-LAP-014', slug: 'ultrabook-fourteen', name: 'Ultrabook Fourteen',
    category: 'workspace', price: 149900, stock: 11, cost: 104800,
    shortDescription: 'Fourteen-inch aluminium laptop at 1.2kg.',
    description: 'A fanless fourteen-inch machine in a single piece of aluminium, weighing 1.2kg with a full day of battery. Two ports that both charge it.',
    image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&q=80',
  },
  {
    sku: 'AUR-MON-015', slug: 'portable-colour-display', name: 'Portable Colour Display',
    category: 'workspace', price: 40500, stock: 0, cost: 23000,
    shortDescription: 'Fifteen-inch travel display, colour calibrated.',
    description: 'Calibrated to sRGB at the factory with the report in the box, powered over a single cable and standing up on its own folding cover.',
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-020', slug: 'weekender-duffel', name: 'Weekender Duffel',
    category: 'travel', price: 24900, stock: 34, cost: 14000,
    shortDescription: 'Waxed canvas duffel sized for a cabin locker.',
    description: 'Waxed canvas over a leather base, with a separate compartment for shoes and a strap that stays on a shoulder. Sized to pass as cabin baggage.',
    image: 'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-021', slug: 'commuter-backpack', name: 'Commuter Backpack',
    category: 'travel', price: 19200, stock: 51, cost: 10700,
    shortDescription: 'Sixteen-litre pack with a padded laptop sleeve.',
    description: 'Sixteen litres, a suspended laptop sleeve and a back panel that stays comfortable on a bicycle. Recycled ripstop throughout.',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-022', slug: 'leather-daypack', name: 'Leather Daypack',
    category: 'travel', price: 33500, stock: 16, cost: 18900,
    shortDescription: 'Full-grain leather daypack that ages in.',
    description: 'Vegetable-tanned full-grain leather with solid brass hardware. Unlined, so it takes the shape of whatever it carries and darkens where it is handled.',
    image: 'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-023', slug: 'packable-rucksack', name: 'Packable Rucksack',
    category: 'travel', price: 8600, stock: 96, cost: 3800,
    shortDescription: 'Twenty-litre rucksack that folds into its own pocket.',
    description: 'Twenty litres of ripstop nylon that packs down to the size of a fist, for the second bag a trip turns out to need. Taped seams.',
    image: 'https://images.unsplash.com/photo-1581605405669-fcdf81165afa?w=800&q=80',
  },
  {
    sku: 'AUR-LUG-024', slug: 'cabin-suitcase', name: 'Cabin Suitcase',
    category: 'travel', price: 45900, compareAtPrice: 52000, stock: 22, cost: 26000,
    shortDescription: 'Hard-shell cabin case with sealed bearings.',
    description: 'A polycarbonate shell on four sealed-bearing wheels that stay quiet on a concourse. Interior compression panel, and a lock that airport security can open.',
    image: 'https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-025', slug: 'canvas-market-tote', name: 'Canvas Market Tote',
    category: 'travel', price: 6700, stock: 120, cost: 2800,
    shortDescription: 'Heavy cotton tote with a flat base.',
    description: 'Eighteen-ounce cotton canvas with a flat base that lets it stand up on its own, and handles long enough to go over a shoulder in a coat.',
    image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=800&q=80',
  },
  {
    sku: 'AUR-BAG-026', slug: 'structured-leather-bag', name: 'Structured Leather Bag',
    category: 'travel', price: 51500, stock: 9, lowStockThreshold: 10, cost: 29100,
    shortDescription: 'Structured leather bag with a woven front panel.',
    description: 'A structured frame in smooth leather with a hand-woven front panel, lined in cotton twill. Carries by the top handle or on a detachable strap.',
    image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800&q=80',
  },
  {
    sku: 'AUR-LMP-030', slug: 'architect-desk-lamp', name: 'Architect Desk Lamp',
    category: 'lighting', price: 16900, stock: 0, cost: 9500,
    shortDescription: 'Counterweighted task lamp with a warm dimmable head.',
    description: 'A counterweighted arm that stays exactly where it is put, with a dimmable head that runs from a warm 2700K up to a neutral 4000K.',
    image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=80',
  },
  {
    sku: 'AUR-LMP-031', slug: 'floor-lamp-arc', name: 'Arc Floor Lamp',
    category: 'lighting', price: 37200, stock: 12, cost: 21600,
    shortDescription: 'Marble-based arc lamp for reading corners.',
    description: 'A marble base heavy enough to hold a two-metre arc steady, finished in brushed brass. Takes a standard bulb, so replacements are never a problem.',
    image: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
  },
  {
    sku: 'AUR-LMP-032', slug: 'pendant-shade', name: 'Pendant Shade',
    category: 'lighting', price: 11400, stock: 44, cost: 5900,
    shortDescription: 'Powder-coated steel pendant with a fabric flex.',
    description: 'A wide steel shade that throws light down onto a table rather than around a room, on a two-metre fabric flex you can shorten without tools.',
    image: 'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=800&q=80',
  },
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data while NODE_ENV=production.');
    process.exit(1);
  }

  const db = createKnex({ url: env.DATABASE_URL, schema: 'commerce', applicationName: 'admin-seed' });

  try {
    const categoryIdBySlug = new Map<string, string>();
    for (const category of CATEGORIES) {
      const [record] = await db('categories')
        .insert({
          id: randomUUID(),
          slug: category.slug,
          name: category.name,
          description: category.description,
          position: category.position,
          is_active: true,
        })
        .onConflict('slug')
        .merge(['name', 'description', 'position'])
        .returning('*');
      categoryIdBySlug.set(category.slug, record.id);
      console.log(`seeded category ${category.slug}`);
    }

    for (const product of PRODUCTS) {
      const categoryId = categoryIdBySlug.get(product.category);
      if (!categoryId) continue;

      const [record] = await db('products')
        .insert({
          id: randomUUID(),
          sku: product.sku,
          slug: product.slug,
          name: product.name,
          description: product.description,
          short_description: product.shortDescription,
          category_id: categoryId,
          price: product.price.toFixed(2),
          compare_at_price: product.compareAtPrice ? product.compareAtPrice.toFixed(2) : null,
          cost_price: product.cost.toFixed(2),
          stock_quantity: product.stock,
          low_stock_threshold: product.lowStockThreshold ?? 5,
          status: 'ACTIVE',
        })
        .onConflict('sku')
        .merge([
          'name',
          'price',
          'compare_at_price',
          'cost_price',
          'stock_quantity',
          'low_stock_threshold',
          'status',
          'category_id',
        ])
        .returning('*');

      const [{ count: openingBalances }] = await db('inventory_movements')
        .where({ product_id: record.id, reason: 'INITIAL' })
        .count<Array<{ count: string }>>('* as count');

      if (Number(openingBalances) === 0 && record.stock_quantity > 0) {
        await db('inventory_movements').insert({
          id: randomUUID(),
          product_id: record.id,
          sku: record.sku,
          product_name: record.name,
          reason: 'INITIAL',
          delta: record.stock_quantity,
          quantity_before: 0,
          quantity_after: record.stock_quantity,
          unit_cost: product.cost.toFixed(2),
          note: 'Demo seed opening stock',
        });
      }

      const [{ count: imageCount }] = await db('product_images')
        .where({ product_id: record.id })
        .count<Array<{ count: string }>>('* as count');

      if (Number(imageCount) === 0) {
        await db('product_images').insert({
          id: randomUUID(),
          product_id: record.id,
          url: product.image,
          alt_text: product.name,
          position: 0,
          is_primary: true,
        });
      }
      console.log(`seeded product ${product.sku} (${product.stock} in stock)`);
    }

    const [totals] = (await db('products').select(
      db.raw('count(*) AS products'),
      db.raw('COALESCE(SUM(stock_quantity), 0) AS units'),
    )) as unknown as Array<{ products: string; units: string }>;
    console.log(
      `\nCatalogue ready: ${Number(totals.products)} products, ${Number(totals.units)} units in stock, ` +
        `${CATEGORIES.length} categories.`,
    );
    console.log('Run `npm run seed:orders -w @ecom/admin-service` to place demo orders through the real checkout path.');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('Seeding failed', error);
  process.exit(1);
});

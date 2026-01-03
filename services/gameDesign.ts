
/**
 * OSMOS PRIME: DESIGN DOCUMENTATION
 * 
 * 1. RPG PROGRESSION
 * - Experience Points (XP): Earned through absorbing food (small), AIs (medium), and Players (high).
 * - Leveling: Each level grants Skill Points used to customize the cell's physical attributes.
 * - Persistence: Upon death, the player loses their current mass but retains their Level, Skill Points, and Class.
 * 
 * 2. CELL CLASSES
 * - Predator: Enhanced visual range and speed. Digestion efficiency +50%.
 * - Tank: Massive defense. Splits are 50% slower but split-cells can reform faster.
 * - Parasite: Can attach to larger cells and drain mass over time without killing them immediately.
 * - Assassin: Reduced visual signature. Can 'dash' (expend mass for sudden burst).
 * - Support: Emanates a field that buffs health regeneration for faction members.
 * 
 * 3. AI BEHAVIOR MODEL (The "Ecosystem" Engine)
 * - Memory: AIs remember players who attacked them.
 * - Faction Logic: AIs belong to one of 3 factions (Biological, Synthetic, Void).
 * - Social Intelligence: Smaller AIs will follow larger faction-friendly AIs for protection.
 * - Ambush: AIs will hide in "Dark Zones" and wait for low-health entities.
 * 
 * 4. BIOME MECHANICS
 * - Toxic Mire: Slowly drains mass; high density of food particles.
 * - Magma Core: Deals high 'burn' damage; enhances Speed and Attack Power.
 * - Nutrient Field: Increases mass regeneration. Faction territory wars occur here.
 * - Dark Zones: Fog of war logic. Invisibility for Assassin class.
 * 
 * 5. WORLD EVENTS
 * - Infection: A random 'virus' cell enters, turning AIs into aggressive zombies that spread mass-draining debuffs.
 * - Meteor Shower: Falling rocks that break cells into fragments but contain high-value 'Star Dust' (XP boosters).
 * - Faction War: World map highlights regions where faction AI will clash. Players can join for massive rewards.
 * 
 * 6. ADDICTION LOOP
 * - The "Just One More Level" Hook: Seeing stats increase creates a desire to reach the next power tier.
 * - Territory Control: Players feel ownership over biomes where their faction is winning.
 * - Build Diversity: Experimenting with "Speed Tanks" or "Tank Assassins" via skill trees.
 * 
 * 7. MONETIZATION (Ethical Model)
 * - Cosmetics: Cell skins, particle trails, and custom 'death' animations.
 * - Battle Pass: Rewards XP boosters and unique cosmetic themes.
 * - NO PAY-TO-WIN: No stats or mass can be purchased with real money.
 */

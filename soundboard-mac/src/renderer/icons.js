// The app's own icon set: 100 line icons on a 24×24 grid, drawn with
// `currentColor` so they take any colour. Used for the interface and for
// customizing bashes and scene kits.
(function (root) {
  const F = 'class="f"'; // filled detail
  // [id, name, category, svg markup]
  const ICONS = [
    // ---- Combat ----
    ['sword', 'Sword', 'Combat', '<path d="M20 4l-1 4L8.5 18.5l-3-3L16 5z"/><path d="M4 14l6 6"/><path d="M6.5 17.5l-3 3"/>'],
    ['crossed-swords', 'Crossed swords', 'Combat', '<path d="M4 4l11 11M20 4L9 15"/><path d="M4 4h3M4 4v3M20 4h-3M20 4v3"/><path d="M13 17l4-4M7 13l4 4"/><path d="M16 16l3.5 3.5M8 16l-3.5 3.5"/>'],
    ['dagger', 'Dagger', 'Combat', '<path d="M12 2l2 3v9h-4V5z"/><path d="M8 14h8"/><path d="M12 14v4"/><circle cx="12" cy="20" r="1.8"/>'],
    ['axe', 'Battle axe', 'Combat', '<path d="M12 2.5V22"/><path d="M12 5.5c2.5 0 5-1 7-2.5 2 3.5 2 8 0 11.5-2-1.5-4.5-2.5-7-2.5"/><path d="M12 5.5c-2.5 0-5-1-7-2.5-2 3.5-2 8 0 11.5 2-1.5 4.5-2.5 7-2.5"/>'],
    ['bow', 'Bow and arrow', 'Combat', '<path d="M8 3c7 3 7 15 0 18"/><path d="M8 3v18" opacity=".6"/><path d="M3 12h16"/><path d="M16 9l3 3-3 3"/><path d="M3 12l-1-2M3 12l-1 2M5 12l-1-2M5 12l-1 2"/>'],
    ['shield', 'Shield', 'Combat', '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M12 8v8M8 12h8"/>'],
    ['helmet', 'Helmet', 'Combat', '<path d="M5 20v-8a7 7 0 0 1 14 0v8z"/><path d="M5 13h14"/><path d="M12 13v7"/><path d="M12 5V3"/>'],
    ['hammer', 'War hammer', 'Combat', '<path d="M4 20l10-10"/><path d="M10 6.5l3-3 7.5 7.5-3 3z"/>'],
    ['mace', 'Mace', 'Combat', '<path d="M12 12v10"/><circle cx="12" cy="7.5" r="4"/><path d="M12 2v1.5M7 4l1 1M17 4l-1 1M5.5 8H7M17 8h1.5"/>'],
    ['explosion', 'Explosion', 'Combat', '<path d="M12 2l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z"/>'],
    ['fist', 'Fist', 'Combat', '<path d="M7 11V8a1.5 1.5 0 0 1 3 0v2M10 9V7a1.5 1.5 0 0 1 3 0v3M13 9.5V8a1.5 1.5 0 0 1 3 0v2.5M16 10a1.5 1.5 0 0 1 3 0v4c0 4-3 7-6.5 7S6 18.5 6 15v-2.5A1.5 1.5 0 0 1 7.5 11H10a2 2 0 0 1 0 4H8"/>'],

    // ---- Magic ----
    ['wand', 'Magic wand', 'Magic', '<path d="M4 20L15 9"/><path d="M14 8l2 2"/><path d="M18 2v3M16.5 3.5h3M20 9v2M19 10h2M11 3v2M10 4h2"/>'],
    ['staff', 'Staff', 'Magic', '<path d="M7 22l8-14"/><circle cx="16.5" cy="5.5" r="2.8"/><path d="M20.5 2.5l-1 1M13 3l1 1M21 9l-1-.5"/>'],
    ['potion', 'Potion', 'Magic', '<path d="M10 2.5h4"/><path d="M10.5 2.5v5.2a6.5 6.5 0 1 0 3 0V2.5"/><path d="M6.5 14.5h11"/>'],
    ['crystal-ball', 'Crystal ball', 'Magic', '<circle cx="12" cy="10" r="7"/><path d="M7 21h10l-1.5-3.3h-7z"/><path d="M8.8 7.2a3.6 3.6 0 0 1 2.8-2"/>'],
    ['spellbook', 'Spellbook', 'Magic', '<path d="M4 19.5V4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5 1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M12 6.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2L8.8 8.8 11 8.5z"/>'],
    ['scroll', 'Scroll', 'Magic', '<path d="M17 20H6.5A2.5 2.5 0 0 1 4 17.5V17h11v.5a2.5 2.5 0 0 0 5 0V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v11"/><path d="M10 8h6M10 12h6"/>'],
    ['sparkle', 'Sparkle', 'Magic', '<path d="M11 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/><path d="M19 15v5M16.5 17.5h5"/>'],
    ['rune', 'Rune circle', 'Magic', '<circle cx="12" cy="12" r="9"/><path d="M12 3.5l7.4 12.8H4.6z"/><circle cx="12" cy="12" r="2"/>'],
    ['flame', 'Flame', 'Magic', '<path d="M12 2c2 4 7 6.5 7 12a7 7 0 0 1-14 0c0-3.5 2.2-5.5 3.5-8 .8 1.8 1.8 2.8 3 3 .3-2.5 0-4.6.5-7z"/><path d="M12 21a3 3 0 0 1-3-3c0-1.8 1.4-2.8 3-4.5 1.6 1.7 3 2.7 3 4.5a3 3 0 0 1-3 3z"/>'],
    ['bolt', 'Lightning bolt', 'Magic', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'],
    ['wizard-hat', 'Wizard hat', 'Magic', '<path d="M5 19L11 3c1 4 3.5 6 7 7l-3.5 2 2.5 7z"/><path d="M3 19.5c3 1 15 1 18 0"/><path d="M10 13l.8 1.5M13 9.5h.8"/>'],
    ['cauldron', 'Cauldron', 'Magic', '<path d="M5 10h14v3a7 7 0 0 1-14 0z"/><path d="M3.5 10h17"/><path d="M8 20.5l1-1.8M16 20.5l-1-1.8"/><circle cx="10" cy="6" r="1.5"/><circle cx="14" cy="4" r="1"/>'],

    // ---- Creatures ----
    ['dragon', 'Dragon', 'Creatures', '<path d="M5 21c0-6 2-9.5 5-12L8 3l4.5 4H15l6 3-1 2.5h-4l-2 1 3.5 1.5-4.5 1c-1.5 1-2 3-2 5"/><circle cx="14.5" cy="9.2" r="1" class="f"/><path d="M8.5 14.5c-2-1-4-.5-5.5 1M7.8 17.5c-1.6-.4-3.2 0-4.5 1.2"/>'],
    ['skull', 'Skull', 'Creatures', '<path d="M12 3a8 8 0 0 0-8 8c0 2.5 1.2 4.5 3 5.8V20h10v-3.2c1.8-1.3 3-3.3 3-5.8a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.8"/><circle cx="15" cy="11.5" r="1.8"/><path d="M10 20v-2.2M14 20v-2.2M12 14.5l-1 1.8h2z"/>'],
    ['ghost', 'Ghost', 'Creatures', '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z"/><circle cx="9.5" cy="10" r="1.1" ' + F + '/><circle cx="14.5" cy="10" r="1.1" ' + F + '/>'],
    ['bat', 'Bat', 'Creatures', '<path d="M12 9C10 6.5 6 4.5 2 5.5c2 2 2.5 5 1.5 8.5 2-1.5 4-1 5 1 1-1.5 2.5-1 3.5 2 1-3 2.5-3.5 3.5-2 1-2 3-2.5 5-1-1-3.5-.5-6.5 1.5-8.5-4-1-8 1-10 3.5z"/><path d="M10.6 8.2l-.3-2 1.4 1.3M13.4 8.2l.3-2-1.4 1.3"/>'],
    ['spider', 'Spider', 'Creatures', '<circle cx="12" cy="14" r="3"/><circle cx="12" cy="9.3" r="1.8"/><path d="M12 2v5.5"/><path d="M9.5 12.5L5 9.5 3 10.5M9.2 14H4l-2 2M9.8 15.8L6.5 18l-1 3M14.5 12.5l4.5-3 2 1M14.8 14H20l2 2M14.2 15.8l3.3 2.2 1 3"/>'],
    ['snake', 'Snake', 'Creatures', '<path d="M17 6.5c-2-2.5-6-2.5-7 .5s2.5 4 4 6-.5 5.5-4 6S4 18 3 17"/><circle cx="18" cy="7.5" r="2"/><path d="M20 8l2 .5M20 8.5l1.5 1.5"/>'],
    ['paw', 'Paw print', 'Creatures', '<path d="M12 12.5c2.5 0 5 3 5 5.5 0 1.5-1.3 2.5-3 2.5-1 0-1.3-.5-2-.5s-1 .5-2 .5c-1.7 0-3-1-3-2.5 0-2.5 2.5-5.5 5-5.5z"/><circle cx="5.5" cy="11" r="1.8"/><circle cx="9.2" cy="6.5" r="1.8"/><circle cx="14.8" cy="6.5" r="1.8"/><circle cx="18.5" cy="11" r="1.8"/>'],
    ['claws', 'Claw marks', 'Creatures', '<path d="M6 3c3 5 4 11 2 18M11.5 3c3 5 4 11 2 18M17 3c3 5 4 11 2 18"/>'],
    ['eye', 'Eye', 'Creatures', '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="1" ' + F + '/>'],
    ['demon', 'Demon', 'Creatures', '<circle cx="12" cy="14" r="7"/><path d="M6.8 9.5L4 3l5.2 4.4M17.2 9.5L20 3l-5.2 4.4"/><path d="M8.8 13l2 1M15.2 13l-2 1M9.5 17.5c1.5 1 3.5 1 5 0"/>'],
    ['tentacle', 'Tentacle', 'Creatures', '<path d="M3 21c0-5.5 3.5-8.5 8-9.5 4-1 5.5-3.5 4.7-5.8-.8-2.2-3.7-2.3-4.3-.4-.4 1.3.8 2.4 2 1.6"/><path d="M8.5 21c.3-3.5 2.5-5 5.5-6 4.5-1.5 7-5 6-9.5-.6-2.6-2.6-3.8-5-3.5"/><circle cx="7.5" cy="18" r=".8"/><circle cx="10.5" cy="14.8" r=".8"/><circle cx="14.5" cy="12.8" r=".8"/>'],

    // ---- People ----
    ['party', 'Adventuring party', 'People', '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a7 7 0 0 1 4 6.5"/>'],
    ['hood', 'Hooded rogue', 'People', '<path d="M12 3C8 3 6 6.5 6 10.5V14c0 1.5-2 2.5-3 4v3h18v-3c-1-1.5-3-2.5-3-4v-3.5C18 6.5 16 3 12 3z"/><path d="M9 13c0-3.5 1.3-5.5 3-5.5s3 2 3 5.5c-1 1.5-2 2-3 2s-2-.5-3-2z"/><circle cx="10.8" cy="11.6" r=".7" class="f"/><circle cx="13.2" cy="11.6" r=".7" class="f"/>'],
    ['speech', 'Dialogue', 'People', '<path d="M4 5h16v11H9.5L5 20v-4H4z"/><path d="M8 9h8M8 12h5"/>'],
    ['mask', 'Theater mask', 'People', '<path d="M3 4h10v6a5 5 0 0 1-10 0z"/><path d="M6 8h1M10 8h1M6.5 11.5a2.5 2.5 0 0 0 4 0"/><path d="M15 8h6v6a5 5 0 0 1-8.7 3.4"/><path d="M17 11h1M15.8 15.2a2.5 2.5 0 0 1 3.4 0"/>'],
    ['heart', 'Heart', 'People', '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>'],
    ['laugh', 'Laughing face', 'People', '<circle cx="12" cy="12" r="9"/><path d="M8 13.5a4.5 4.5 0 0 0 8 0z"/><path d="M8 9.5l1.5-1 1.5 1M13 9.5l1.5-1 1.5 1"/>'],
    ['shock', 'Shocked face', 'People', '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="16" rx="2" ry="2.4"/><circle cx="9" cy="10" r="1.3"/><circle cx="15" cy="10" r="1.3"/><path d="M7.5 7l2-1M16.5 7l-2-1"/>'],

    // ---- Places ----
    ['castle', 'Castle', 'Places', '<path d="M3 21V8h2.5v2H8V8h2.5v4h3V8H16v2h2.5V8H21v13z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>'],
    ['tower', 'Tower', 'Places', '<path d="M7 21V9h10v12"/><path d="M6 9V4h2v2h2V4h4v2h2V4h2v5z"/><path d="M12 12v2"/><path d="M10 21v-3a2 2 0 0 1 4 0v3"/>'],
    ['mug', 'Tavern mug', 'Places', '<path d="M5 7h10v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M15 10h2a3 3 0 0 1 0 6h-2"/><path d="M4.5 7a2.8 2.8 0 0 1 3-3 3 3 0 0 1 4.5-.5A3 3 0 0 1 15.5 7"/><path d="M8.5 11v6M11.5 11v6"/>'],
    ['tent', 'Tent', 'Places', '<path d="M2 20L12 4l10 16z"/><path d="M9.5 20L12 14l2.5 6"/><path d="M12 4l-1.5-2M12 4l1.5-2"/>'],
    ['cave', 'Cave', 'Places', '<path d="M2 20c1-6 4-12 10-14 6 2 9 8 10 14z"/><path d="M8 20c0-3.5 2-6.5 4-6.5s4 3 4 6.5"/>'],
    ['mountain', 'Mountain', 'Places', '<path d="M2 20l7-12 4 6 3-4 6 10z"/><path d="M6.8 11.8L9 13l2-1.6"/>'],
    ['tree', 'Tree', 'Places', '<path d="M12 21v-6"/><path d="M12 15c-4.5 0-7-2.5-7-6a7 7 0 0 1 14 0c0 3.5-2.5 6-7 6z"/><path d="M12 15l-2.5-2.5M12 13.5l2-2"/>'],
    ['pine', 'Pine forest', 'Places', '<path d="M12 2L7 9h3l-4 6h4l-4 5h12l-4-5h4l-4-6h3z"/><path d="M12 20v2"/>'],
    ['ship', 'Ship', 'Places', '<path d="M3 15h18l-2.5 5h-13z"/><path d="M12 3v12"/><path d="M12 4l6 8.5h-6M12 6.5L7 12.5h5"/>'],
    ['temple', 'Temple', 'Places', '<path d="M3 9l9-6 9 6z"/><path d="M5.5 9v9M9.8 9v9M14.2 9v9M18.5 9v9"/><path d="M3 21h18M4 18h16"/>'],
    ['map', 'Map', 'Places', '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'],
    ['compass', 'Compass', 'Places', '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'],
    ['jolly-roger', 'Pirate flag', 'Places', '<path d="M5 21V3"/><path d="M5 4h14v10H5"/><circle cx="12" cy="8" r="2.2"/><path d="M9 12.5l6-1.6M15 12.5l-6-1.6"/>'],
    ['gate', 'Dungeon gate', 'Places', '<path d="M4 21V9a8 6 0 0 1 16 0v12"/><path d="M3 21h18M8 21V5.8M12 21V3M16 21V5.8M4 12h16M4 16.5h16"/>'],
    ['grave', 'Grave', 'Places', '<path d="M6 21V9a6 6 0 0 1 12 0v12"/><path d="M3 21h18"/><path d="M12 8v7M9.5 10.5h5"/>'],

    // ---- Nature & weather ----
    ['sun', 'Sun', 'Nature', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
    ['moon', 'Moon', 'Nature', '<path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/><path d="M17 3v3M15.5 4.5h3"/>'],
    ['rain', 'Rain', 'Nature', '<path d="M7 14a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17 5.5 4 4 0 0 1 17 14z"/><path d="M8 17l-1 3M12 16.5l-1.3 4.5M16 17l-1 3"/>'],
    ['storm', 'Thunderstorm', 'Nature', '<path d="M7 14a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17 5.5 4 4 0 0 1 17 14"/><path d="M12.5 12L9.5 17h4L11 22"/>'],
    ['snowflake', 'Snowflake', 'Nature', '<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>'],
    ['wind', 'Wind', 'Nature', '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'],
    ['wave', 'Waves', 'Nature', '<path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'],
    ['mushroom', 'Mushroom', 'Nature', '<path d="M3 12a9 8 0 0 1 18 0z"/><path d="M9 12v6.5a3 3 0 0 0 6 0V12"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="14" cy="7" r="1"/>'],
    ['campfire', 'Campfire', 'Nature', '<path d="M4 20.5l16-4M4 16.5l16 4"/><path d="M12 14.5c-2.5 0-4-1.5-4-3.5 0-2.5 2-3.5 2.5-6.5 1 1.5 1.5 2.5 1.5 3.5 1-1 1.5-2 1.5-3 2 2 2.5 4 2.5 6 0 2-1.5 3.5-4 3.5z"/>'],
    ['volcano', 'Volcano', 'Nature', '<path d="M2 21l6-10h8l6 10z"/><path d="M10 11l-1-3M14 11l1-3M12 9V5"/><path d="M8.5 4c.3-1.5 1.8-2.2 3-1.3M13 3c1-1 2.5-.5 2.8.8"/>'],

    // ---- Treasure & objects ----
    ['crown', 'Crown', 'Treasure', '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>'],
    ['key', 'Key', 'Treasure', '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14.5 8.5l2 2"/>'],
    ['chest', 'Treasure chest', 'Treasure', '<path d="M3 10h18v10H3z"/><path d="M3 10V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/><path d="M10 10v3h4v-3"/>'],
    ['coins', 'Coins', 'Treasure', '<ellipse cx="9" cy="6.5" rx="6" ry="3"/><path d="M3 6.5v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4"/><path d="M9 14v3.5c0 1.7 2.7 3 6 3s6-1.3 6-3V13.5c0-1.6-2.4-2.9-5.5-3"/>'],
    ['gem', 'Gem', 'Treasure', '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21L8 9l4-6 4 6z"/>'],
    ['bell', 'Bell', 'Treasure', '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M12 5V3"/>'],
    ['candle', 'Candle', 'Treasure', '<path d="M8 10h8v11H8z"/><path d="M12 10V8"/><path d="M12 6.5c-1.3-1-1.3-2.7 0-4.5 1.3 1.8 1.3 3.5 0 4.5z"/><path d="M5.5 21h13"/>'],
    ['lantern', 'Lantern', 'Treasure', '<path d="M9 3h6M12 3V1M8 6h8l1 2v9l-1 2H8l-1-2V8z"/><path d="M10 21.5h4"/><path d="M12 10c-1.2 1.2-1.2 2.8 0 4 1.2-1.2 1.2-2.8 0-4z"/>'],
    ['hourglass', 'Hourglass', 'Treasure', '<path d="M6 2h12M6 22h12M7 2c0 6 5 7 5 10s-5 4-5 10M17 2c0 6-5 7-5 10s5 4 5 10"/>'],
    ['torch', 'Torch', 'Treasure', '<path d="M10 22l-1-11h6l-1 11z"/><path d="M12 9c-2 0-3-1.3-3-3 0-2 2-3 3-5 1 2 3 3 3 5 0 1.7-1 3-3 3z"/>'],
    ['war-horn', 'War horn', 'Treasure', '<path d="M4 4c0 9 6 15 15 15"/><path d="M5.8 4c.8 7.5 5.5 11 14.2 10"/><path d="M19 19c1.4-1 1.8-3.2 1-5"/><path d="M4 4h1.8"/><path d="M7.8 12.8l2-1.6M11.4 16.4l1.4-2"/>'],
    ['d20', 'D20 die', 'Treasure', '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 7l5 8H7z"/><path d="M12 2v5M3 7l4 8M21 7l-4 8M7 15l5 7 5-7"/>'],
    ['d6', 'D6 die', 'Treasure', '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.3" ' + F + '/><circle cx="12" cy="12" r="1.3" ' + F + '/><circle cx="15.5" cy="15.5" r="1.3" ' + F + '/>'],
    ['question', 'Mystery', 'Treasure', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".9" ' + F + '/>'],

    // ---- Music & sound ----
    ['note', 'Music', 'Music', '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'],
    ['speaker', 'Speaker', 'Music', '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'],
    ['drum', 'Drum', 'Music', '<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v9c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/><path d="M4 8l5 11.5M20 8l-5 11.5"/><path d="M15 2.5l4.5 3M9 2.5L4.5 5.5"/>'],
    ['lute', 'Lute', 'Music', '<path d="M14 10a5.5 5.5 0 1 1-7.8 7.8C4 15.6 4.5 12 7.5 10.5 9.5 9.5 12 8 14 10z"/><path d="M13 11l7-7M18.5 2.5l3 3"/><circle cx="10" cy="14" r="1.5"/>'],
  ];

  // Interface icons (also part of the set of 100).
  const UI = [
    ['play', 'Play', 'Interface', '<path d="M7 4l13 8-13 8z"/>'],
    ['stop', 'Stop', 'Interface', '<rect x="6" y="6" width="12" height="12" rx="1.5"/>'],
    ['repeat', 'Repeat', 'Interface', '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'],
    ['scissors', 'Clip', 'Interface', '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.2 7.8L20 19M8.2 16.2L20 5"/>'],
    ['layers', 'Ambience', 'Interface', '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>'],
    ['grid', 'All', 'Interface', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
    ['tag', 'Tag', 'Interface', '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>'],
    ['search', 'Search', 'Interface', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'],
    ['plus', 'Add', 'Interface', '<path d="M12 5v14M5 12h14"/>'],
    ['close', 'Close', 'Interface', '<path d="M6 6l12 12M18 6L6 18"/>'],
    ['edit', 'Edit', 'Interface', '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'],
    ['trash', 'Delete', 'Interface', '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'],
    ['download', 'Download', 'Interface', '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>'],
    ['video', 'Video', 'Interface', '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>'],
    ['folder', 'Folder', 'Interface', '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'],
    ['more', 'More', 'Interface', '<circle cx="5" cy="12" r="1.4" ' + F + '/><circle cx="12" cy="12" r="1.4" ' + F + '/><circle cx="19" cy="12" r="1.4" ' + F + '/>'],
  ];

  const ALL = [...ICONS, ...UI];
  const byId = new Map(ALL.map(([id, name, category, svg]) => [id, { id, name, category, svg }]));
  const CATEGORIES = [...new Set(ALL.map((i) => i[2]))];

  // Icons offered for decorating bashes and scene kits (interface icons included).
  const PICKABLE = ALL.map(([id]) => id);

  // Old emoji choices → icon ids, for bashes and kits made before the icon set.
  const FROM_EMOJI = {
    '⚔️': 'crossed-swords', '🐉': 'dragon', '🍺': 'mug', '🔥': 'flame', '🌲': 'pine', '🏰': 'castle', '💀': 'skull',
    '🌊': 'wave', '⚡': 'bolt', '🎲': 'd20', '🧙': 'wizard-hat', '🌙': 'moon', '👑': 'crown', '🕯️': 'candle',
    '🗡️': 'dagger', '🛡️': 'shield', '🐺': 'paw', '👻': 'ghost', '⛈️': 'storm', '🎻': 'lute', '🗺️': 'map',
    '🏴‍☠️': 'jolly-roger', '🎭': 'mask',
  };

  function resolve(id) {
    if (byId.has(id)) return id;
    if (FROM_EMOJI[id]) return FROM_EMOJI[id];
    return 'sparkle';
  }

  // An <svg> element for icon `id`. `size` in px; colour comes from CSS
  // `color` unless `color` is given.
  function el(id, { size = 18, color, title, className = '' } = {}) {
    const icon = byId.get(resolve(id));
    const span = document.createElement('span');
    span.className = `icon ${className}`.trim();
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.svg}</svg>`;
    if (color) span.style.color = color;
    if (title) { span.title = title; span.setAttribute('role', 'img'); span.setAttribute('aria-label', title); }
    return span;
  }

  // Sets an element's content to an icon followed by an optional text label.
  function set(target, id, text = '', opts = {}) {
    target.textContent = '';
    target.append(el(id, { size: 15, ...opts }));
    if (text) {
      const label = document.createElement('span');
      label.className = 'icon-label';
      label.textContent = text;
      target.append(label);
    }
    return target;
  }

  // Replaces <i data-icon="name"> placeholders in static HTML.
  function hydrate(rootEl = document) {
    for (const node of rootEl.querySelectorAll('i[data-icon]')) {
      const size = Number(node.dataset.size) || 16;
      const icon = el(node.dataset.icon, { size, className: node.className });
      node.replaceWith(icon);
    }
  }

  const api = { list: ALL.map(([id, name, category]) => ({ id, name, category })), categories: CATEGORIES, pickable: PICKABLE, get: (id) => byId.get(resolve(id)), resolve, el, set, hydrate, FROM_EMOJI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.Icons = api;
    hydrate(); // scripts load at the end of <body>, so the page is already there
  }
})(this);

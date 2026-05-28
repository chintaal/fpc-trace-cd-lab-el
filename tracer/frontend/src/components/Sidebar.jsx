import React, { useState } from 'react'

const CATEGORIES = {
  array_operations: { label: 'Array Ops',        color: '#39c5cf', icon: '▦' },
  concurrency:      { label: 'Concurrency',       color: '#3fb950', icon: '⚡' },
  polymorphism:     { label: 'Polymorphism',      color: '#bc8cff', icon: '🔗' },
  data_structures:  { label: 'Data Structures',   color: '#388bfd', icon: '◈' },
  distributed:      { label: 'Distributed (CAF)', color: '#d29922', icon: '🌐' },
  intrinsics:       { label: 'Intrinsics',         color: '#e3b341', icon: '∑' },
  procedures:       { label: 'Procedures',         color: '#f85149', icon: '⟨⟩' },
}

const CPXCOL = { LOW: '#3fb950', MEDIUM: '#e3b341', HIGH: '#d29922', VERY_HIGH: '#f85149', UNKNOWN: '#8b949e' }

export default function Sidebar({ constructs, selected, onSelect, metrics = {} }) {
  const [filter, setFilter] = useState('')

  const filtered = constructs.filter(c =>
    !filter ||
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    c.category.toLowerCase().includes(filter.toLowerCase())
  )

  const grouped = {}
  for (const c of filtered) {
    const cat = c.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(c)
  }

  return (
    <aside style={s.sidebar}>
      {/* Header */}
      <div style={s.topBar}>
        <div style={s.brand}>
          <span style={s.brandIcon}>⬡</span>
          <span style={s.title}>Constructs</span>
        </div>
        <span style={s.count}>{constructs.length}</span>
      </div>

      {/* Search */}
      <div style={s.searchWrap}>
        <span style={s.searchIcon}>⌕</span>
        <input
          style={s.search}
          placeholder="Filter constructs…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && (
          <button style={s.clearBtn} onClick={() => setFilter('')}>✕</button>
        )}
      </div>

      {/* Stats strip */}
      <div style={s.statsStrip}>
        <Stat label="constructs" value={constructs.length} color="#3fb950" />
        <Stat label="stages" value={5} color="#e3b341" />
        <Stat label="patterns" value={23} color="#bc8cff" />
      </div>

      {/* List */}
      <div style={s.list}>
        {Object.entries(grouped).map(([cat, items]) => {
          const meta = CATEGORIES[cat] || { label: cat, color: '#8b949e', icon: '◉' }
          return (
            <div key={cat} style={s.group}>
              <div style={s.groupHeader}>
                <span style={{ color: meta.color, fontSize: 11 }}>{meta.icon}</span>
                <span style={{ ...s.catLabel, color: meta.color }}>{meta.label}</span>
                <span style={{ ...s.catCount, color: meta.color + '80' }}>{items.length}</span>
              </div>
              {items.map(c => (
                <ConstructCard
                  key={c.id}
                  construct={c}
                  isSelected={selected === c.id}
                  onClick={() => onSelect(c.id)}
                  badges={metrics[c.id]?.badges || []}
                  catColor={meta.color}
                />
              ))}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={s.noResults}>No constructs match "{filter}"</div>
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <span style={s.footerText}>Parse Tree → Semantics → FIR → HLFIR → LLVM IR</span>
      </div>
    </aside>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={s.stat}>
      <span style={{ ...s.statValue, color }}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  )
}

function ConstructCard({ construct, isSelected, onClick, badges, catColor }) {
  const num = construct.id.split('_')[0]
  const accent = isSelected ? (catColor || 'var(--accent-blue)') : 'transparent'

  return (
    <button
      style={{
        ...s.card,
        background: isSelected ? `${catColor || '#388bfd'}0f` : 'transparent',
        borderLeft: `3px solid ${isSelected ? (catColor || 'var(--accent-blue)') : 'transparent'}`,
      }}
      onClick={onClick}
    >
      <div style={s.cardRow}>
        <span style={{ ...s.num, color: isSelected ? catColor : 'var(--text-muted)' }}>{num}</span>
        <span style={{ ...s.cardName, color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {construct.name}
        </span>
      </div>

      <div style={s.cardMeta}>
        <span style={{
          ...s.complexTag,
          color: CPXCOL[construct.complexity] || '#8b949e',
          background: `${CPXCOL[construct.complexity] || '#8b949e'}15`,
          border: `1px solid ${CPXCOL[construct.complexity] || '#8b949e'}30`,
        }}>
          {construct.complexity}
        </span>
        <span style={s.stdTag}>{construct.fortran_standard}</span>
        <div style={s.perfBadges}>
          {badges.slice(0, 3).map(b => (
            <span key={b.id} title={b.label} style={{ fontSize: 11 }}>{b.icon}</span>
          ))}
        </div>
      </div>

      {isSelected && construct.key_patterns && (
        <div style={s.patterns}>
          {construct.key_patterns.slice(0, 2).map(kp => (
            <code key={kp} style={{ ...s.patChip, color: catColor || '#388bfd',
              background: `${catColor || '#388bfd'}12`,
              border: `1px solid ${catColor || '#388bfd'}25` }}>
              {kp.length > 22 ? kp.slice(0,22)+'…' : kp}
            </code>
          ))}
        </div>
      )}
    </button>
  )
}

const s = {
  sidebar: {
    width: 252, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px 8px', borderBottom: '1px solid var(--border-subtle)',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 6 },
  brandIcon: { color: 'var(--accent-blue)', fontSize: 14, fontWeight: 900 },
  title: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.8px', color: 'var(--text-secondary)',
  },
  count: {
    fontSize: 10, color: 'var(--accent-blue)', background: 'rgba(56,139,253,.12)',
    padding: '1px 7px', borderRadius: 10, border: '1px solid rgba(56,139,253,.25)',
    fontWeight: 700,
  },
  searchWrap: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 10px', borderBottom: '1px solid var(--border-subtle)',
  },
  searchIcon: { color: 'var(--text-muted)', fontSize: 15, flexShrink: 0 },
  search: {
    flex: 1, background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
  },
  clearBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: 10, padding: '2px 4px', flexShrink: 0,
  },
  statsStrip: {
    display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
  },
  stat: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '6px 4px', borderRight: '1px solid var(--border-subtle)',
  },
  statValue: { fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1 },
  statLabel: { fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginTop: 2 },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0 8px' },
  group: { marginBottom: 2 },
  groupHeader: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '8px 14px 3px', position: 'sticky', top: 0,
    background: 'var(--bg-surface)', zIndex: 1, borderTop: '1px solid var(--border-subtle)',
  },
  catLabel: { fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', flex: 1 },
  catCount: { fontSize: 9, fontWeight: 700 },
  card: {
    width: '100%', textAlign: 'left', padding: '7px 14px',
    cursor: 'pointer', borderLeft: '3px solid transparent',
    transition: 'all .12s', display: 'block', background: 'transparent',
  },
  cardRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  num: { fontSize: 9, fontFamily: 'var(--font-mono)', minWidth: 18, fontWeight: 700 },
  cardName: { fontSize: 12, fontWeight: 600, lineHeight: 1.3, flex: 1 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 5 },
  complexTag: {
    fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 8,
    textTransform: 'uppercase', letterSpacing: '.4px',
  },
  stdTag: { fontSize: 9, color: 'var(--text-muted)' },
  perfBadges: { display: 'flex', gap: 2, marginLeft: 'auto' },
  patterns: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 },
  patChip: {
    fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
    fontFamily: 'var(--font-mono)',
  },
  noResults: { padding: '20px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 },
  footer: {
    padding: '7px 14px', borderTop: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)', flexShrink: 0,
  },
  footerText: {
    fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
    display: 'block', textAlign: 'center', letterSpacing: '.3px',
  },
}

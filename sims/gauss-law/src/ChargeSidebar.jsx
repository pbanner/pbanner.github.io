import { CHARGE_TYPES } from './chargeTypes.js';
import ChargeIcon from './ChargeIcon.jsx';

// One icon in the sidebar's column. Reports its own hover in and out (as
// { label, rect } / null) rather than rendering a label itself -- the label
// floats *outside* the thin sidebar, so App.jsx renders it. Same pattern as
// the optics lab's SidebarIconButton.
function SidebarIconButton({ label, active, ariaLabel, dataRole, onPointerDown, onClick, onHoverButton, children }) {
  return (
    <button
      type="button"
      className={`sidebar-icon-button ${active ? 'active' : ''}`}
      aria-label={ariaLabel}
      data-role={dataRole}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onMouseEnter={(e) => onHoverButton({ label, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={() => onHoverButton(null)}
    >
      {children}
    </button>
  );
}

// Simple outline trash can, drawn inline like ChargeIcon.
function TrashIcon({ size = 28, color = '#333' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.5h5v2" />
      <path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </svg>
  );
}

// Left-edge overlay toolbar, styled after the optics lab's: a thin column
// of icons. Each charge icon starts App.jsx's click-vs-drag gesture on
// pointerdown (onButtonPointerDown) -- a plain click arms click-to-place,
// a real drag drops the charge wherever the pointer is released.
//
// Below them, the trash can works two ways, also like the optics lab's:
// click it to toggle delete mode (then click charges to delete them), or
// drag a placed charge onto it (Viewer.jsx looks for its
// data-role="trash-target" under the pointer on release).
export default function ChargeSidebar({ armedTypeId, onButtonPointerDown, removeMode, onToggleRemoveMode, onHoverButton }) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-heading">Add</div>
      <div className="sidebar-column">
        {CHARGE_TYPES.map((type) => (
          <SidebarIconButton
            key={type.id}
            label={type.label}
            active={armedTypeId === type.id}
            ariaLabel={`Add ${type.label}`}
            onPointerDown={(e) => onButtonPointerDown(type.id, e)}
            onHoverButton={onHoverButton}
          >
            <ChargeIcon type={type} />
          </SidebarIconButton>
        ))}
      </div>
      <div className="sidebar-divider" />
      <SidebarIconButton
        label="Delete"
        active={removeMode}
        ariaLabel="Toggle delete mode"
        dataRole="trash-target"
        onClick={onToggleRemoveMode}
        onHoverButton={onHoverButton}
      >
        <TrashIcon color={removeMode ? '#fff' : '#333'} />
      </SidebarIconButton>
    </div>
  );
}

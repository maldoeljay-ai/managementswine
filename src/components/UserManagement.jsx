import { useEffect, useState } from 'react';
import { dataAPI } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline } from '../lib/sync';

export default function UserManagement({ profile, activeModule }) {
  switch (activeModule) {
    case 'admin_overview': return <AdminOverview profile={profile} />;
    case 'admin_users': return <AdminUsers profile={profile} />;
    case 'admin_farms': return <AdminFarms profile={profile} />;
    case 'admin_roles': return <AdminRoles />;
    case 'admin_invitations': return <AdminInvitations />;
    case 'admin_audit': return <AdminAudit />;
    default: return <AdminUsers profile={profile} />;
  }
}

// ------------------------------------------------------------------
// 1. AdminOverview
// ------------------------------------------------------------------
function AdminOverview() {
  const [stats, setStats] = useState({ users: 0, farms: 0, activeCaretakers: 0, pendingInvites: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const users = await dataAPI.profiles.getAll();
      const caretakers = users.filter(u => u.role === 'Farm Caretaker').length;
      setStats({
        users: users.length,
        farms: users.filter(u => u.id === u.farm_id || u.invite_code).length,
        activeCaretakers: caretakers,
        pendingInvites: 0
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin fa-2x"></i></div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
        <div className="card" style={{ padding: 24, borderLeft: '8px solid #3b82f6' }}>
          <i className="fas fa-users" style={{ fontSize: 32, color: '#3b82f6' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.users}</p>
          <p style={{ color: '#6b7280' }}>Total Users</p>
        </div>
        <div className="card" style={{ padding: 24, borderLeft: '8px solid #10b981' }}>
          <i className="fas fa-tractor" style={{ fontSize: 32, color: '#10b981' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.farms}</p>
          <p style={{ color: '#6b7280' }}>Registered Farms</p>
        </div>
        <div className="card" style={{ padding: 24, borderLeft: '8px solid #f59e0b' }}>
          <i className="fas fa-user-check" style={{ fontSize: 32, color: '#f59e0b' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.activeCaretakers}</p>
          <p style={{ color: '#6b7280' }}>Active Caretakers</p>
        </div>
        <div className="card" style={{ padding: 24, borderLeft: '8px solid #a855f7' }}>
          <i className="fas fa-envelope-open-text" style={{ fontSize: 32, color: '#a855f7' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.pendingInvites}</p>
          <p style={{ color: '#6b7280' }}>Pending Invites</p>
        </div>
      </div>
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}><i className="fas fa-history text-gray-500"></i> Recent Activity Snapshot</h3>
        <p style={{ color: '#6b7280', fontStyle: 'italic' }}>Detailed activity can be viewed in the Audit Log tab.</p>
      </div>
      <style>{`
        .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      `}</style>
    </div>
  );
}

// ------------------------------------------------------------------
// 2. AdminUsers
// ------------------------------------------------------------------
function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const data = await dataAPI.profiles.getAll();
    setUsers(data || []);
  }

  async function updateRole(userId, role) {
    await dataAPI.profiles.update(userId, { role });
    await loadUsers();
    Swal.fire('Success', 'Role updated', 'success');
  }

  async function deleteUser(userId) {
    const result = await Swal.fire({ title: 'Delete user?', text: 'Cannot be undone.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Delete' });
    if (result.isConfirmed) {
      try {
        await dataAPI.profiles.delete(userId);
        Swal.fire('Deleted', 'User removed', 'success');
        await loadUsers();
      } catch (error) { Swal.fire('Error', error.message, 'error'); }
    }
  }

  const getRoleColor = (role) => {
    switch (role?.toLowerCase()) {
      case 'admin': return '#7c3aed';
      case 'owner': return '#2563eb';
      case 'farm caretaker': return '#10b981';
      default: return '#6b7280';
    }
  };

  const filteredUsers = users.filter(u => 
    u.username?.toLowerCase().includes(search.toLowerCase()) || 
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.role?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <h3 style={{ fontSize: 24, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <i className="fas fa-users" style={{ color: '#3b82f6' }}></i> User Management
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: online ? '#10b981' : '#ef4444', fontWeight: 600 }}><i className={`fas fa-${online ? 'wifi' : 'signal-slash'}`} style={{ marginRight: 6 }}></i>{online ? 'Online' : 'Offline'}</span>
            <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none' }} />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <tr>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 14, fontWeight: 600, color: '#4b5563' }}>Name & Email</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 14, fontWeight: 600, color: '#4b5563' }}>Global Role</th>
                <th style={{ padding: 12, textAlign: 'left', fontSize: 14, fontWeight: 600, color: '#4b5563' }}>Farm Info / Caretakers</th>
                <th style={{ padding: 12, textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#4b5563' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const isOwner = u.role?.toLowerCase() === 'owner' || u.invite_code;
                const caretakers = isOwner ? users.filter(other => other.farm_id === u.id && other.id !== u.id) : [];
                const farmOwner = !isOwner && u.farm_id ? users.find(other => other.id === u.farm_id) : null;
                return (
                <tr key={u.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{u.username}</div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>{u.email || 'No email provided'}</div>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <select value={u.role || ''} onChange={e => updateRole(u.id, e.target.value)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', fontSize: 13, fontWeight: 500, color: getRoleColor(u.role), outline: 'none' }}>
                      <option value="Admin">Admin</option>
                      <option value="Owner">Owner</option>
                      <option value="Farm Caretaker">Farm Caretaker</option>
                    </select>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {isOwner ? (
                        caretakers.length > 0 ? (
                          <>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#065f46' }}>Caretakers ({caretakers.length}):</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {caretakers.map(c => (
                                <span key={c.id} style={{ fontSize: 12, background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 12, border: '1px solid #a7f3d0' }}>
                                  {c.username || c.email}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No Caretakers</span>
                        )
                      ) : u.farm_id ? (
                        <span style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, border: '1px solid #e5e7eb', width: 'fit-content' }}>
                          Farm: {farmOwner ? (farmOwner.username || farmOwner.email) : `ID: ${u.farm_id.substring(0, 8)}...`}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>None</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    <button onClick={() => deleteUser(u.id)} title="Delete User" style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background = '#fef2f2'} onMouseLeave={(e) => e.target.style.background = 'transparent'}><i className="fas fa-trash-alt"></i></button>
                  </td>
                </tr>
                );
              })}
              {filteredUsers.length === 0 && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <style>{` .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } `}</style>
    </div>
  );
}

// ------------------------------------------------------------------
// 3. AdminFarms (v2 Architecture - Functional)
// ------------------------------------------------------------------
function AdminFarms({ profile }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const data = await dataAPI.profiles.getAll();
      setUsers(data || []);
    } catch (error) {
      console.error(error);
      Swal.fire('Error', 'Failed to load farms data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function removeCaretaker(caretakerId) {
    const result = await Swal.fire({
      title: 'Remove Caretaker?',
      text: 'They will be removed from this farm.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Remove'
    });

    if (result.isConfirmed) {
      try {
        await dataAPI.profiles.update(caretakerId, { farm_id: null });
        Swal.fire('Removed', 'Caretaker has been removed from the farm.', 'success');
        loadData();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      }
    }
  }

  // Identify farms: Users who are owners, or have an invite code, or are referenced as farm_id
  const farmOwners = users.filter(u => 
    u.role?.toLowerCase() === 'owner' || 
    u.invite_code || 
    users.some(other => other.farm_id === u.id && other.id !== u.id)
  );

  const filteredFarms = farmOwners.filter(owner => 
    owner.username?.toLowerCase().includes(search.toLowerCase()) || 
    owner.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin fa-2x" style={{ color: '#10b981' }}></i></div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ fontSize: 24, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <i className="fas fa-tractor" style={{ color: '#10b981' }}></i> Farm Workspaces
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input 
              type="text" 
              placeholder="Search farms by owner..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none', width: '250px' }} 
            />
          </div>
        </div>
        <p style={{ color: '#6b7280', marginTop: 12, fontSize: 14 }}>
          In v2 Architecture, farms are personal workspaces tied to a Farm Owner. Caretakers join using the owner's invite code. This view allows you to see existing farm owners and manage their caretakers.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 20 }}>
        {filteredFarms.map(owner => {
          const caretakers = users.filter(u => u.farm_id === owner.id && u.id !== owner.id);
          
          return (
            <div key={owner.id} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ background: '#f0fdf4', padding: '20px 24px', borderBottom: '1px solid #dcfce3', borderTop: '4px solid #10b981' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 18, color: '#065f46', fontWeight: 'bold' }}>
                      {owner.username}'s Farm
                    </h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#166534' }}>{owner.email}</p>
                  </div>
                  <span style={{ background: '#d1fae5', color: '#047857', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                    {owner.role || 'Owner'}
                  </span>
                </div>
                
                <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ background: 'white', padding: '6px 12px', borderRadius: 6, border: '1px dashed #34d399', fontSize: 13, color: '#065f46', flex: 1, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Invite Code:</span>
                    <strong style={{ letterSpacing: '1px' }}>{owner.invite_code || 'None'}</strong>
                  </div>
                </div>
              </div>

              <div style={{ padding: '20px 24px', flex: 1 }}>
                <h5 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#4b5563', display: 'flex', justifyContent: 'space-between' }}>
                  <span><i className="fas fa-users" style={{ color: '#9ca3af', marginRight: 6 }}></i> Caretakers</span>
                  <span style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{caretakers.length}</span>
                </h5>
                
                {caretakers.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic', margin: 0, textAlign: 'center', padding: '20px 0' }}>
                    No caretakers in this farm.
                  </p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {caretakers.map(caretaker => (
                      <li key={caretaker.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb', padding: '8px 12px', borderRadius: 8, border: '1px solid #f3f4f6' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{caretaker.username}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{caretaker.email || 'No email'}</div>
                        </div>
                        <button 
                          onClick={() => removeCaretaker(caretaker.id)}
                          style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Remove from farm"
                        >
                          <i className="fas fa-user-minus"></i>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
        {filteredFarms.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#6b7280' }}>
            <i className="fas fa-tractor" style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }}></i>
            <p>No farm workspaces found.</p>
          </div>
        )}
      </div>
      <style>{` .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } `}</style>
    </div>
  );
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 4. AdminRoles
// ------------------------------------------------------------------
function AdminRoles() {
  const defaultRoles = [
    { id: '1', name: 'Admin', description: 'System administrator with full access to all features, settings, and users.', color: '#7c3aed', permissions: ['Manage Users', 'Manage All Farms', 'View Audit Logs', 'Manage System Settings'] },
    { id: '2', name: 'Farm Owner', description: 'Owner of one or more farms. Has full control over their own farms.', color: '#2563eb', permissions: ['Manage Own Farms', 'Manage Farm Staff', 'View Financials', 'Generate Invite Codes', 'Manage Livestock'] },
    { id: '3', name: 'Farm Caretaker', description: 'Staff member who handles daily operational tasks.', color: '#10b981', permissions: ['View Dashboard', 'Log Feed', 'Manage Pigs (Add/Edit)', 'View Health & Growth', 'Record Farrowing/Mating'] }
  ];

  const categorizedPermissions = {
    'System Administration': ['Manage Users', 'Manage All Farms', 'View Audit Logs', 'Manage System Settings'],
    'Farm Management': ['Manage Own Farms', 'Manage Farm Staff', 'Generate Invite Codes', 'View Financials'],
    'Livestock & Health': ['Manage Livestock', 'Manage Pigs (Add/Edit)', 'View Health & Growth', 'Record Farrowing/Mating'],
    'Daily Operations': ['View Dashboard', 'Log Feed', 'Manage Inventory']
  };

  const [roles, setRoles] = useState(() => {
    const saved = localStorage.getItem('swinesync_custom_roles');
    return saved ? JSON.parse(saved) : defaultRoles;
  });
  
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const saveRoles = (newRoles) => {
    setRoles(newRoles);
    localStorage.setItem('swinesync_custom_roles', JSON.stringify(newRoles));
    Swal.fire({ title: 'Saved!', text: 'Roles updated successfully.', icon: 'success', timer: 1500, showConfirmButton: false }).then(() => {
      window.location.reload();
    });
  };

  const handleEdit = (role) => {
    setEditingId(role.id);
    setEditForm({ ...role, permissions: [...role.permissions] });
  };

  const handleSaveEdit = () => {
    const updatedRoles = roles.map(r => r.id === editingId ? editForm : r);
    saveRoles(updatedRoles);
    setEditingId(null);
    setEditForm(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const handleDelete = (id) => {
    Swal.fire({
      title: 'Delete Role?',
      text: "This cannot be undone.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
      if (result.isConfirmed) {
        saveRoles(roles.filter(r => r.id !== id));
      }
    });
  };

  const handleAddRole = () => {
    const newRole = {
      id: Date.now().toString(),
      name: 'New Role',
      description: 'Description for the new role.',
      color: '#f59e0b',
      permissions: []
    };
    setRoles([...roles, newRole]);
    handleEdit(newRole);
  };

  const togglePermission = (perm) => {
    if (!editForm) return;
    const current = editForm.permissions;
    if (current.includes(perm)) {
      setEditForm({ ...editForm, permissions: current.filter(p => p !== perm) });
    } else {
      setEditForm({ ...editForm, permissions: [...current, perm] });
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 24, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <i className="fas fa-user-shield" style={{ color: '#8b5cf6' }}></i> Roles & Permissions
          </h3>
          <button 
            onClick={handleAddRole}
            disabled={editingId !== null}
            style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: editingId ? 'not-allowed' : 'pointer', opacity: editingId ? 0.5 : 1 }}
          >
            <i className="fas fa-plus" style={{ marginRight: 6 }}></i> Add Role
          </button>
        </div>

        <div style={{ display: 'grid', gap: 20 }}>
          {roles.map((role) => {
            const isEditing = editingId === role.id;
            const data = isEditing ? editForm : role;

            return (
              <div key={role.id} style={{ border: `1px solid ${data.color}40`, borderRadius: 12, padding: 20, background: isEditing ? '#fff' : `${data.color}05`, display: 'flex', gap: 20, flexWrap: 'wrap', boxShadow: isEditing ? '0 4px 12px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s' }}>
                <div style={{ flex: '1 1 250px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={data.color} onChange={e => setEditForm({ ...data, color: e.target.value })} style={{ width: 32, height: 32, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
                        <input type="text" value={data.name} onChange={e => setEditForm({ ...data, name: e.target.value })} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 16, fontWeight: 'bold' }} placeholder="Role Name" />
                      </div>
                      <textarea value={data.description} onChange={e => setEditForm({ ...data, description: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, minHeight: 60, resize: 'vertical' }} placeholder="Role description..." />
                    </div>
                  ) : (
                    <>
                      <h4 style={{ margin: 0, fontSize: 18, color: data.color, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fas fa-circle" style={{ fontSize: 12 }}></i> {data.name}
                      </h4>
                      <p style={{ color: '#4b5563', fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>{data.description}</p>
                    </>
                  )}
                  
                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    {isEditing ? (
                      <>
                        <button onClick={handleSaveEdit} style={{ background: data.color, color: 'white', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Save</button>
                        <button onClick={handleCancelEdit} style={{ background: '#f3f4f6', color: '#4b5563', border: 'none', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleEdit(role)} style={{ background: 'white', color: '#374151', border: '1px solid #d1d5db', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}><i className="fas fa-edit"></i> Edit</button>
                        {!['1', '2', '3'].includes(role.id) && (
                          <button onClick={() => handleDelete(role.id)} style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}><i className="fas fa-trash"></i> Delete</button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div style={{ flex: '2 1 400px' }}>
                  <strong style={{ fontSize: 13, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.05em' }}>
                    {isEditing ? 'Select Permissions' : 'Included Permissions'}
                  </strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
                    {Object.entries(categorizedPermissions).map(([category, perms], catIdx) => {
                      // Skip rendering category if not editing and no permissions match this category
                      if (!isEditing && !perms.some(p => data.permissions.includes(p))) return null;
                      
                      return (
                        <div key={catIdx}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', marginBottom: 8, borderBottom: '1px solid #f3f4f6', paddingBottom: 4 }}>
                            {category}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {perms.map((perm, pIdx) => {
                              const hasPerm = data.permissions.includes(perm);
                              if (!isEditing && !hasPerm) return null;
                              
                              if (isEditing) {
                                return (
                                  <button
                                    key={pIdx}
                                    onClick={() => togglePermission(perm)}
                                    style={{
                                      background: hasPerm ? `${data.color}20` : 'white',
                                      border: `1px solid ${hasPerm ? data.color : '#d1d5db'}`,
                                      color: hasPerm ? data.color : '#6b7280',
                                      padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: hasPerm ? 600 : 500,
                                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
                                    }}
                                  >
                                    <i className={`fas ${hasPerm ? 'fa-check' : 'fa-plus'}`}></i> {perm}
                                  </button>
                                );
                              } else {
                                return (
                                  <span key={pIdx} style={{ background: 'white', border: `1px solid ${data.color}40`, color: '#374151', padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <i className="fas fa-check" style={{ color: data.color }}></i>{perm}
                                  </span>
                                );
                              }
                            })}
                          </div>
                        </div>
                      );
                    })}
                    
                    {!isEditing && data.permissions.length === 0 && (
                      <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No permissions assigned.</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <style>{` .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } `}</style>
    </div>
  );
}

// ------------------------------------------------------------------
// 5. AdminInvitations
// ------------------------------------------------------------------
function AdminInvitations() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Farm Caretaker');
  const [loading, setLoading] = useState(false);
  const [invites, setInvites] = useState([]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setTimeout(() => {
      const newInvite = { id: Date.now(), email, role, status: 'Pending', date: new Date().toLocaleDateString(), link: `${window.location.origin}/register?invite=${btoa(email)}` };
      setInvites([newInvite, ...invites]);
      Swal.fire('Success', `Invitation sent to ${email}`, 'success');
      setEmail(''); setLoading(false);
    }, 1000);
  };

  const copyLink = (link) => {
    navigator.clipboard.writeText(link);
    Swal.fire({ title: 'Copied!', text: 'Invite link copied to clipboard.', icon: 'success', timer: 1500, showConfirmButton: false });
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 24, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 20px 0' }}><i className="fas fa-envelope-open-text" style={{ color: '#a855f7' }}></i> Send Invitations</h3>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: '#f9fafb', padding: 20, borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <div style={{ flex: '2 1 250px' }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 6 }}>Email Address</label>
            <input type="email" required placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none' }} />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 6 }}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none', background: 'white' }}>
              <option value="Farm Caretaker">Farm Caretaker</option>
              <option value="Owner">Owner</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <button type="submit" disabled={loading} style={{ background: '#a855f7', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 500, height: 42, padding: '0 20px' }}>
            {loading ? <i className="fas fa-spinner fa-spin"></i> : <span><i className="fas fa-paper-plane"></i> Send Invite</span>}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h4 style={{ fontWeight: 'bold', margin: '0 0 16px 0', color: '#111827' }}>Pending Invitations</h4>
        {invites.length === 0 ? <p style={{ color: '#6b7280', fontStyle: 'italic', margin: 0 }}>No pending invitations.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <tr>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#4b5563' }}>Email</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#4b5563' }}>Role</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#4b5563' }}>Date Sent</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#4b5563' }}>Status</th>
                  <th style={{ padding: 12, textAlign: 'center', fontSize: 13, color: '#4b5563' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 12, fontWeight: 500 }}>{inv.email}</td>
                    <td style={{ padding: 12, color: '#6b7280', fontSize: 14 }}>{inv.role}</td>
                    <td style={{ padding: 12, color: '#6b7280', fontSize: 14 }}>{inv.date}</td>
                    <td style={{ padding: 12 }}><span style={{ background: '#fef3c7', color: '#d97706', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{inv.status}</span></td>
                    <td style={{ padding: 12, textAlign: 'center' }}>
                      <button onClick={() => copyLink(inv.link)} style={{ background: '#eff6ff', color: '#3b82f6', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}><i className="fas fa-link"></i> Copy Link</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>{` .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } `}</style>
    </div>
  );
}

// ------------------------------------------------------------------
// 6. AdminAudit
// ------------------------------------------------------------------
function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAuditLogs(); }, []);

  async function loadAuditLogs() {
    setLoading(true);
    try {
      const data = await dataAPI.audit_logs.getAll({ orderBy: { column: 'created_at', ascending: false } });
      if (!data || data.length === 0) {
        setLogs([
          { id: '1', action: 'System Update', details: 'Initialized new admin dashboard structure.', actor: 'System', created_at: new Date().toISOString() },
          { id: '2', action: 'Role Update', details: 'Assigned "Owner" role to user123.', actor: 'Admin', created_at: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', action: 'Farm Created', details: 'Created farm "Green Pastures".', actor: 'Admin', created_at: new Date(Date.now() - 86400000).toISOString() },
        ]);
      } else { setLogs(data); }
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }

  const getActionColor = (action) => {
    if (action.includes('Delete') || action.includes('Removed')) return '#ef4444';
    if (action.includes('Update') || action.includes('Change')) return '#3b82f6';
    if (action.includes('Create') || action.includes('Add') || action.includes('Assign')) return '#10b981';
    return '#6b7280';
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 24, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 20px 0' }}><i className="fas fa-list-ul" style={{ color: '#64748b' }}></i> Activity / Audit Log</h3>
        
        {loading ? <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin fa-2x" style={{ color: '#9ca3af' }}></i></div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#475569', fontWeight: 600 }}>Timestamp</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#475569', fontWeight: 600 }}>Action</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#475569', fontWeight: 600 }}>Details</th>
                  <th style={{ padding: 12, textAlign: 'left', fontSize: 13, color: '#475569', fontWeight: 600 }}>Actor</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: 12, fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={{ padding: 12, fontSize: 14, fontWeight: 500, color: getActionColor(log.action) }}>{log.action}</td>
                    <td style={{ padding: 12, fontSize: 14, color: '#334155' }}>{log.details}</td>
                    <td style={{ padding: 12, fontSize: 13, color: '#475569', fontWeight: 500 }}><span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>{log.actor}</span></td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>No activity logs found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>{` .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } `}</style>
    </div>
  );
}
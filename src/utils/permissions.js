export const isAuthorized = (profile, requiredRoles = ['Admin', 'Owner']) => {
  return requiredRoles.includes(profile?.role);
};

# Node.js Roles

Role-based authorization package for Node.js, ported from [Meteor roles](https://github.com/Meteor-Community-Packages/meteor-roles).

## Features

- Hierarchical roles (roles can have parent/child relationships)
- Scoped roles (roles can be limited to specific contexts)
- MongoDB-based storage
- Async/await support
- Compatible API with Meteor roles package

## Installation

```bash
npm install nodejs-roles
```

## Quick Start

```javascript
const { MongoClient } = require('mongodb');
const Roles = require('nodejs-roles');

async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('myapp');
  const roles = new Roles(db);

  // Create roles
  await roles.createRoleAsync('admin');
  await roles.createRoleAsync('user');

  // Add hierarchy
  await roles.addRolesToParentAsync('user', 'admin');

  // Assign roles
  await roles.addUsersToRolesAsync('user123', 'user');

  // Check permissions
  const isAdmin = await roles.userIsInRoleAsync('user123', 'admin'); // true
  const userRoles = await roles.getRolesForUserAsync('user123'); // ['user', 'admin']
}
```

## API Reference

### Core Methods

- `createRoleAsync(roleName, options)` - Create a new role
- `deleteRoleAsync(roleName)` - Delete a role
- `addUsersToRolesAsync(users, roles, options)` - Add users to roles
- `removeUsersFromRolesAsync(users, roles, options)` - Remove users from roles
- `setUserRolesAsync(users, roles, options)` - Set user's roles (replace existing)
- `userIsInRoleAsync(user, roles, options)` - Check if user has role
- `getRolesForUserAsync(user, options)` - Get user's roles
- `getUsersInRoleAsync(roles, options)` - Get users with specific roles
- `getAllRoles()` - Get all defined roles

### Hierarchical Methods

- `addRolesToParentAsync(roles, parent)` - Add roles as children of parent
- `removeRolesFromParentAsync(roles, parent)` - Remove roles from parent
- `isParentOfAsync(parent, child)` - Check if parent is ancestor of child

### Scope Methods

- `getScopesForUserAsync(user, roles)` - Get scopes for user with roles
- `renameScopeAsync(oldName, newName)` - Rename a scope
- `removeScopeAsync(name)` - Remove a scope

### Other Methods

- `renameRoleAsync(oldName, newName)` - Rename a role

## Scopes

Scopes allow you to have independent sets of roles for different contexts (e.g., multi-tenant applications, different communities).

```javascript
// Add roles with scopes
await roles.addUsersToRolesAsync('user123', 'admin', 'company1');
await roles.addUsersToRolesAsync('user123', 'user', 'company2');

// Check roles in specific scopes
await roles.userIsInRoleAsync('user123', 'admin', 'company1'); // true
await roles.userIsInRoleAsync('user123', 'admin', 'company2'); // false

// Check roles across all scopes (global + specified scope)
await roles.userIsInRoleAsync('user123', 'admin'); // true (checks global scope)

// Get roles for user in specific scope
await roles.getRolesForUserAsync('user123', { scope: 'company1' });

// Get users with role in specific scope
await roles.getUsersInRoleAsync('admin', { scope: 'company1' });

// Get all scopes for a user
await roles.getScopesForUserAsync('user123');

// Get scopes where user has specific role
await roles.getScopesForUserAsync('user123', 'admin');
```

### Scope Options

- `scope`: String - Specific scope to check
- `anyScope`: Boolean - Check roles in any scope (default: false)
- `onlyScoped`: Boolean - Only return scoped roles, exclude global (default: false)

## Options

Many methods accept an `options` object with additional parameters:

- `onlyAssigned`: Boolean - Return only directly assigned roles, not inherited (default: false)
- `fullObjects`: Boolean - Return full objects instead of just names (default: false)

## Database Schema

### Roles Collection
```javascript
{
  _id: "roleName",
  children: [{ _id: "childRole" }]
}
```

### Role Assignments Collection
```javascript
{
  _id: ObjectId,
  role: { _id: "roleName" },
  user: { _id: "userId" },
  scope: "scopeName", // or null
  inheritedRoles: [{ _id: "inheritedRole" }]
}
```

## Differences from Meteor Version

- Requires explicit MongoDB connection
- All methods are async
- Returns user IDs instead of user objects
- No automatic publishing/subscription system
- No client-side sync methods

## License

MIT

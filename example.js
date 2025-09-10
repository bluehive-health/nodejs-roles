const { MongoClient } = require('mongodb');
const Roles = require('./index');

async function example() {
  // Connect to MongoDB (replace with your connection string)
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('example_roles');

  // Create Roles instance
  const roles = new Roles(db);

  try {
    // Clean up
    await db.collection('roles').deleteMany({});
    await db.collection('role-assignment').deleteMany({});

    // Create roles
    await roles.createRoleAsync('admin');
    await roles.createRoleAsync('user');
    await roles.createRoleAsync('editor');
    await roles.createRoleAsync('viewer');

    // Create hierarchy
    await roles.addRolesToParentAsync('editor', 'admin');
    await roles.addRolesToParentAsync('viewer', 'user');
    await roles.addRolesToParentAsync('editor', 'user');

    // Add users to roles with scopes
    await roles.addUsersToRolesAsync('alice', 'admin', 'company1');
    await roles.addUsersToRolesAsync('bob', 'user', 'company1');
    await roles.addUsersToRolesAsync('charlie', 'editor', 'company2');

    // Check roles with scopes
    console.log('Alice is admin in company1:', await roles.userIsInRoleAsync('alice', 'admin', 'company1'));
    console.log('Alice is admin in company2:', await roles.userIsInRoleAsync('alice', 'admin', 'company2')); // Should be false
    console.log('Bob is editor in company1:', await roles.userIsInRoleAsync('bob', 'editor', 'company1')); // Should be true due to hierarchy
    console.log('Charlie is admin in company2:', await roles.userIsInRoleAsync('charlie', 'admin', 'company2')); // Should be false

    // Check global roles (no scope specified)
    console.log('Alice is admin globally:', await roles.userIsInRoleAsync('alice', 'admin')); // Should be false (role is scoped)

    // Add a global role
    await roles.addUsersToRolesAsync('diana', 'admin'); // Global role
    console.log('Diana is admin globally:', await roles.userIsInRoleAsync('diana', 'admin')); // Should be true
    console.log('Diana is admin in company1:', await roles.userIsInRoleAsync('diana', 'admin', 'company1')); // Should be true (global works anywhere)

    // Get roles for users with scopes
    console.log('Alice roles in company1:', await roles.getRolesForUserAsync('alice', { scope: 'company1' }));
    console.log('Bob roles in company1:', await roles.getRolesForUserAsync('bob', { scope: 'company1' }));

    // Get users in roles with scopes
    console.log('Users with admin in company1:', await roles.getUsersInRoleAsync('admin', { scope: 'company1' }));

    // Get scopes for users
    console.log('Scopes for Alice:', await roles.getScopesForUserAsync('alice'));
    console.log('Scopes for Alice with admin role:', await roles.getScopesForUserAsync('alice', 'admin'));

  } finally {
    await client.close();
  }
}

if (require.main === module) {
  example().catch(console.error);
}

module.exports = example;

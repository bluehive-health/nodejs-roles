const { MongoClient } = require('mongodb');
const assert = require('node:assert/strict');
const Roles = require('./index');

async function test() {
  // Use in-memory MongoDB for testing, or connect to a real one
  const client = new MongoClient('mongodb://localhost:27017');
  try {
    await client.connect();
    const db = client.db('test_roles');

    // Clean up
    await db.collection('roles').deleteMany({});
    await db.collection('role-assignment').deleteMany({});

    const roles = new Roles(db);

    console.log('Creating roles...');
    await roles.createRoleAsync('admin');
    await roles.createRoleAsync('user');
    await roles.createRoleAsync('editor');

    console.log('Adding hierarchy...');
    await roles.addRolesToParentAsync('editor', 'admin');
    await roles.addRolesToParentAsync('user', 'editor');

    console.log('Adding user to role...');
    await roles.addUsersToRolesAsync('user123', 'user');

    console.log('Checking roles...');
    console.log('user123 is admin:', await roles.userIsInRoleAsync('user123', 'admin'));
    console.log('user123 is editor:', await roles.userIsInRoleAsync('user123', 'editor'));
    console.log('user123 is user:', await roles.userIsInRoleAsync('user123', 'user'));

    console.log('User roles:', await roles.getRolesForUserAsync('user123'));

    console.log('Users in admin role:', await roles.getUsersInRoleAsync('admin'));

    // Test scope functionality
    console.log('\nTesting scope functionality...');

    // Add scoped roles
    await roles.addUsersToRolesAsync('user456', 'admin', 'scope1');
    await roles.addUsersToRolesAsync('user456', 'user', 'scope2');
    await roles.addUsersToRolesAsync('user999', 'admin', { scope: 'scopeObj' });
    await roles.addUsersToRolesAsync('user998', 'admin', { ifExists: false }, 'scopeArg');

    // Check scoped roles
    const user456AdminInScope1 = await roles.userIsInRoleAsync('user456', 'admin', 'scope1');
    const user456AdminInScope2 = await roles.userIsInRoleAsync('user456', 'admin', 'scope2');
    const user456UserInScope2 = await roles.userIsInRoleAsync('user456', 'user', 'scope2');

    console.log('user456 is admin in scope1:', user456AdminInScope1);
    console.log('user456 is admin in scope2:', user456AdminInScope2);
    console.log('user456 is user in scope2:', user456UserInScope2);

    // Verify Meteor-compatible call shape: userId, roleName, scope
    assert.equal(user456AdminInScope1, true);
    assert.equal(user456AdminInScope2, false);
    assert.equal(user456UserInScope2, true);

    // Verify options-object and explicit-scope-arg call shapes.
    assert.equal(await roles.userIsInRoleAsync('user999', 'admin', { scope: 'scopeObj' }), true);
    assert.equal(await roles.userIsInRoleAsync('user999', 'admin', 'scopeObj'), true);
    assert.equal(await roles.userIsInRoleAsync('user998', 'admin', { anyScope: false }, 'scopeArg'), true);
    assert.equal(await roles.userIsInRoleAsync('user998', 'admin', { scope: 'wrong' }, 'scopeArg'), true);

    // Check global scope (should only check global roles, not scoped ones)
    const user456AdminGlobal = await roles.userIsInRoleAsync('user456', 'admin');
    console.log('user456 is admin globally:', user456AdminGlobal); // Should be false (role is in scope1, not global)
    assert.equal(user456AdminGlobal, false);

    // Get roles in specific scope
    console.log('user456 roles in scope1:', await roles.getRolesForUserAsync('user456', { scope: 'scope1' }));
    console.log('user456 roles in scope2:', await roles.getRolesForUserAsync('user456', { scope: 'scope2' }));

    // Get users in role with scope
    console.log('Users with admin in scope1:', await roles.getUsersInRoleAsync('admin', { scope: 'scope1' }));

    // Add a global role
    await roles.addUsersToRolesAsync('user789', 'admin'); // No scope = global

    // Check global role
    const user789AdminGlobal = await roles.userIsInRoleAsync('user789', 'admin');
    const user789AdminInScope1 = await roles.userIsInRoleAsync('user789', 'admin', 'scope1');
    console.log('user789 is admin globally:', user789AdminGlobal); // Should be true
    console.log('user789 is admin in scope1:', user789AdminInScope1); // Should be true (global roles work in any scope)
    assert.equal(user789AdminGlobal, true);
    assert.equal(user789AdminInScope1, true);

    // Guard behavior should match Meteor package semantics.
    assert.equal(await roles.userIsInRoleAsync(null, 'admin', 'scope1'), false);
    assert.equal(await roles.userIsInRoleAsync({ _id: 42 }, 'admin', 'scope1'), false);
    assert.equal(await roles.userIsInRoleAsync('user456', null, 'scope1'), false);

    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  test();
}

module.exports = test;

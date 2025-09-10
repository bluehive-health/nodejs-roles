const { MongoClient } = require('mongodb');

class Roles {
  constructor(db) {
    this.db = db;
    this.rolesCollection = db.collection('roles');
    this.roleAssignmentCollection = db.collection('role-assignment');
  }

  /**
   * Check if role name is valid
   * @param {string} roleName
   * @private
   */
  _checkRoleName(roleName) {
    if (
      !roleName ||
      typeof roleName !== 'string' ||
      roleName.trim() !== roleName
    ) {
      throw new Error(`Invalid role name '${roleName}'.`);
    }
  }

  /**
   * Check if scope name is valid
   * @param {string} scopeName
   * @private
   */
  _checkScopeName(scopeName) {
    if (scopeName === null) return;

    if (
      !scopeName ||
      typeof scopeName !== 'string' ||
      scopeName.trim() !== scopeName
    ) {
      throw new Error(`Invalid scope name '${scopeName}'.`);
    }
  }

  /**
   * Normalize options
   * @param {Object|string} options
   * @returns {Object}
   * @private
   */
  _normalizeOptions(options) {
    options = options === undefined ? {} : options;

    if (options === null || typeof options === 'string' || typeof options === 'number') {
      options = { scope: options };
    }

    options.scope = this._normalizeScopeName(options.scope);

    return options;
  }

  /**
   * Normalize scope name
   * @param {string} scopeName
   * @returns {string|null}
   * @private
   */
  _normalizeScopeName(scopeName) {
    // map undefined and null to null
    if (scopeName == null) {
      return null;
    } else {
      return scopeName;
    }
  }

  /**
   * Create a new role.
   * @param {string} roleName Name of role.
   * @param {Object} [options] Options: unlessExists
   * @returns {Promise<string|null>} ID of the new role or null.
   */
  async createRoleAsync(roleName, options = {}) {
    this._checkRoleName(roleName);

    options = { unlessExists: false, ...options };

    const existingRole = await this.rolesCollection.findOne({ _id: roleName });

    if (existingRole) {
      await this.rolesCollection.updateOne(
        { _id: roleName },
        { $setOnInsert: { children: [] } },
        { upsert: true }
      );
      return null;
    } else {
      const result = await this.rolesCollection.insertOne({
        _id: roleName,
        children: []
      });
      return result.insertedId;
    }
  }

  /**
   * Delete an existing role.
   * @param {string} roleName Name of role.
   */
  async deleteRoleAsync(roleName) {
    this._checkRoleName(roleName);

    // Remove all assignments
    await this.roleAssignmentCollection.deleteMany({
      'role._id': roleName
    });

    // Remove from parent roles
    await this.rolesCollection.updateMany(
      { 'children._id': roleName },
      { $pull: { children: { _id: roleName } } }
    );

    // Delete the role
    await this.rolesCollection.deleteOne({ _id: roleName });
  }

  /**
   * Add users to roles.
   * @param {string|string[]} users User ID(s)
   * @param {string|string[]} roles Role name(s)
   * @param {Object|string} [options] Options or scope
   */
  async addUsersToRolesAsync(users, roles, options = {}) {
    options = this._normalizeOptions(options);

    users = Array.isArray(users) ? users : [users];
    roles = Array.isArray(roles) ? roles : [roles];

    for (const userId of users) {
      for (const roleName of roles) {
        await this._addUserToRoleAsync(userId, roleName, options);
      }
    }
  }

  /**
   * Add a user to a role internally
   * @param {string} userId
   * @param {string} roleName
   * @param {Object} options
   * @private
   */
  async _addUserToRoleAsync(userId, roleName, options = {}) {
    this._checkRoleName(roleName);
    this._checkScopeName(options.scope);

    const scope = options.scope || null;

    // Check if assignment already exists
    const existing = await this.roleAssignmentCollection.findOne({
      'user._id': userId,
      'role._id': roleName,
      scope
    });

    if (existing) return;

    // Get the role document
    const role = await this.rolesCollection.findOne({ _id: roleName });
    if (!role) {
      throw new Error(`Role '${roleName}' does not exist.`);
    }

    // Get inherited roles
    const inheritedRoles = await this._getInheritedRoleNamesAsync(role);

    await this.roleAssignmentCollection.insertOne({
      role: { _id: roleName },
      user: { _id: userId },
      scope,
      inheritedRoles: inheritedRoles.map(r => ({ _id: r }))
    });
  }

  /**
   * Get inherited role names
   * @param {Object} role
   * @returns {Promise<string[]>}
   * @private
   */
  async _getInheritedRoleNamesAsync(role) {
    const inherited = new Set([role._id]);

    const processRole = async (r) => {
      if (r.children) {
        for (const child of r.children) {
          if (!inherited.has(child._id)) {
            inherited.add(child._id);
            const childRole = await this.rolesCollection.findOne({ _id: child._id });
            if (childRole) {
              await processRole(childRole);
            }
          }
        }
      }
    };

    await processRole(role);
    return Array.from(inherited);
  }

  /**
   * Check if user is in role
   * @param {string|Object} user User ID or user object
   * @param {string|string[]} roles Role name(s)
   * @param {Object|string} [options] Options or scope
   * @returns {Promise<boolean>}
   */
  async userIsInRoleAsync(user, roles, options = {}) {
    const userId = typeof user === 'string' ? user : user._id;
    options = this._normalizeOptions(options);

    // Set default options
    options = { anyScope: false, ...options };

    roles = Array.isArray(roles) ? roles : [roles];

    const query = {
      'user._id': userId,
      'inheritedRoles._id': { $in: roles }
    };

    if (!options.anyScope) {
      query.scope = { $in: [options.scope, null] };
    }

    const count = await this.roleAssignmentCollection.countDocuments(query);
    return count > 0;
  }

  /**
   * Get roles for user
   * @param {string|Object} user
   * @param {Object} [options]
   * @returns {Promise<string[]>}
   */
  async getRolesForUserAsync(user, options = {}) {
    const userId = typeof user === 'string' ? user : user._id;
    options = this._normalizeOptions(options);

    // Set default options
    options = {
      fullObjects: false,
      onlyAssigned: false,
      anyScope: false,
      onlyScoped: false,
      ...options
    };

    const query = { 'user._id': userId };

    if (!options.anyScope) {
      query.scope = { $in: [options.scope] };
      if (!options.onlyScoped) {
        query.scope.$in.push(null);
      }
    }

    const assignments = await this.roleAssignmentCollection.find(query).toArray();
    const roles = new Set();

    for (const assignment of assignments) {
      if (options.onlyAssigned) {
        roles.add(assignment.role._id);
      } else {
        roles.add(assignment.role._id);
        for (const inherited of assignment.inheritedRoles) {
          roles.add(inherited._id);
        }
      }
    }

    return Array.from(roles);
  }

  /**
   * Remove users from roles
   * @param {string|string[]} users
   * @param {string|string[]} roles
   * @param {Object} [options]
   */
  async removeUsersFromRolesAsync(users, roles, options = {}) {
    options = this._normalizeOptions(options);
    users = Array.isArray(users) ? users : [users];
    roles = Array.isArray(roles) ? roles : [roles];

    for (const userId of users) {
      for (const roleName of roles) {
        await this._removeUserFromRoleAsync(userId, roleName, options);
      }
    }
  }

  /**
   * Remove user from role internally
   * @param {string} userId
   * @param {string} roleName
   * @param {Object} options
   * @private
   */
  async _removeUserFromRoleAsync(userId, roleName, options = {}) {
    this._checkRoleName(roleName);
    this._checkScopeName(options.scope);

    const query = {
      'user._id': userId,
      'role._id': roleName
    };

    if (options.scope !== undefined) {
      query.scope = options.scope;
    }

    await this.roleAssignmentCollection.deleteMany(query);
  }

  /**
   * Set user roles (replace existing)
   * @param {string|string[]} users
   * @param {string|string[]} roles
   * @param {Object} [options]
   */
  async setUserRolesAsync(users, roles, options = {}) {
    options = this._normalizeOptions(options);
    users = Array.isArray(users) ? users : [users];
    roles = Array.isArray(roles) ? roles : [roles];

    for (const userId of users) {
      // Remove existing roles
      const removeQuery = { 'user._id': userId };
      if (options.scope !== undefined) {
        removeQuery.scope = options.scope;
      }
      await this.roleAssignmentCollection.deleteMany(removeQuery);

      // Add new roles
      if (roles.length > 0) {
        await this.addUsersToRolesAsync(userId, roles, options);
      }
    }
  }

  /**
   * Add roles to parent
   * @param {string|string[]} rolesNames
   * @param {string} parentName
   */
  async addRolesToParentAsync(rolesNames, parentName) {
    rolesNames = Array.isArray(rolesNames) ? rolesNames : [rolesNames];

    for (const roleName of rolesNames) {
      await this._addRoleToParentAsync(roleName, parentName);
    }
  }

  /**
   * Add role to parent internally
   * @param {string} roleName
   * @param {string} parentName
   * @private
   */
  async _addRoleToParentAsync(roleName, parentName) {
    this._checkRoleName(roleName);
    this._checkRoleName(parentName);

    const role = await this.rolesCollection.findOne({ _id: roleName });
    if (!role) {
      throw new Error(`Role '${roleName}' does not exist.`);
    }

    // Detect cycles
    const inherited = await this._getInheritedRoleNamesAsync(role);
    if (inherited.includes(parentName)) {
      throw new Error(`Roles '${roleName}' and '${parentName}' would form a cycle.`);
    }

    const result = await this.rolesCollection.updateOne(
      {
        _id: parentName,
        'children._id': { $ne: role._id }
      },
      {
        $push: {
          children: { _id: role._id }
        }
      }
    );

    if (result.modifiedCount === 0) return;

    // Update inherited roles in assignments
    const inheritedRoles = [role._id, ...inherited].map(r => ({ _id: r }));

    await this.roleAssignmentCollection.updateMany(
      { 'inheritedRoles._id': parentName },
      {
        $push: {
          inheritedRoles: { $each: inheritedRoles }
        }
      }
    );
  }

  /**
   * Remove roles from parent
   * @param {string|string[]} rolesNames
   * @param {string} parentName
   */
  async removeRolesFromParentAsync(rolesNames, parentName) {
    rolesNames = Array.isArray(rolesNames) ? rolesNames : [rolesNames];

    for (const roleName of rolesNames) {
      await this._removeRoleFromParentAsync(roleName, parentName);
    }
  }

  /**
   * Remove role from parent internally
   * @param {string} roleName
   * @param {string} parentName
   * @private
   */
  async _removeRoleFromParentAsync(roleName, parentName) {
    this._checkRoleName(roleName);
    this._checkRoleName(parentName);

    const role = await this.rolesCollection.findOne({ _id: roleName });
    if (!role) return;

    await this.rolesCollection.updateOne(
      { _id: parentName },
      { $pull: { children: { _id: role._id } } }
    );

    // Update inherited roles in assignments
    const inheritedRoles = await this._getInheritedRoleNamesAsync(role);
    const rolesToRemove = [role._id, ...inheritedRoles].map(r => ({ _id: r }));

    await this.roleAssignmentCollection.updateMany(
      { 'inheritedRoles._id': parentName },
      {
        $pull: {
          inheritedRoles: { $in: rolesToRemove }
        }
      }
    );
  }

  /**
   * Check if parentRole is parent of childRole
   * @param {string} parentRoleName
   * @param {string} childRoleName
   * @returns {Promise<boolean>}
   */
  async isParentOfAsync(parentRoleName, childRoleName) {
    if (parentRoleName === childRoleName) {
      return true;
    }

    if (!parentRoleName || !childRoleName) {
      return false;
    }

    this._checkRoleName(parentRoleName);
    this._checkRoleName(childRoleName);

    const rolesToCheck = [parentRoleName];
    const visited = new Set();

    while (rolesToCheck.length > 0) {
      const roleName = rolesToCheck.pop();

      if (roleName === childRoleName) {
        return true;
      }

      if (visited.has(roleName)) continue;
      visited.add(roleName);

      const role = await this.rolesCollection.findOne({ _id: roleName });
      if (!role) continue;

      rolesToCheck.push(...role.children.map(r => r._id));
    }

    return false;
  }

  /**
   * Get users in role
   * @param {string|string[]} roles
   * @param {Object} [options]
   * @returns {Promise<string[]>} Array of user IDs
   */
  async getUsersInRoleAsync(roles, options = {}) {
    options = this._normalizeOptions(options);

    // Set default options
    options = { anyScope: false, onlyScoped: false, ...options };

    roles = Array.isArray(roles) ? roles : [roles];

    const selector = {
      'inheritedRoles._id': { $in: roles }
    };

    if (!options.anyScope) {
      selector.scope = { $in: [options.scope] };
      if (!options.onlyScoped) {
        selector.scope.$in.push(null);
      }
    }

    const assignments = await this.roleAssignmentCollection.find(selector).toArray();
    const userIds = [...new Set(assignments.map(a => a.user._id))];

    return userIds;
  }

  /**
   * Rename a role
   * @param {string} oldName
   * @param {string} newName
   */
  async renameRoleAsync(oldName, newName) {
    this._checkRoleName(oldName);
    this._checkRoleName(newName);

    if (oldName === newName) return;

    const role = await this.rolesCollection.findOne({ _id: oldName });
    if (!role) {
      throw new Error(`Role '${oldName}' does not exist.`);
    }

    // Insert new role
    const newRole = { ...role, _id: newName };
    await this.rolesCollection.insertOne(newRole);

    // Update assignments
    await this.roleAssignmentCollection.updateMany(
      { 'role._id': oldName },
      { $set: { 'role._id': newName } }
    );

    await this.roleAssignmentCollection.updateMany(
      { 'inheritedRoles._id': oldName },
      { $set: { 'inheritedRoles.$._id': newName } }
    );

    // Update parent references
    await this.rolesCollection.updateMany(
      { 'children._id': oldName },
      { $set: { 'children.$._id': newName } }
    );

    // Remove old role
    await this.rolesCollection.deleteOne({ _id: oldName });
  }

  /**
   * Rename a scope
   * @param {string} oldName
   * @param {string} newName
   */
  async renameScopeAsync(oldName, newName) {
    this._checkScopeName(oldName);
    this._checkScopeName(newName);

    if (oldName === newName) return;

    await this.roleAssignmentCollection.updateMany(
      { scope: oldName },
      { $set: { scope: newName } }
    );
  }

  /**
   * Remove a scope
   * @param {string} name
   */
  async removeScopeAsync(name) {
    this._checkScopeName(name);

    await this.roleAssignmentCollection.deleteMany({ scope: name });
  }

  /**
   * Get all roles
   * @returns {Promise<string[]>}
   */
  async getAllRoles() {
    const roles = await this.rolesCollection.find({}).toArray();
    return roles.map(r => r._id);
  }

  /**
   * Get scopes for user
   * @param {string|Object} user
   * @param {string|string[]} [roles]
   * @returns {Promise<string[]>}
   */
  async getScopesForUserAsync(user, roles) {
    const userId = typeof user === 'string' ? user : user._id;

    if (!userId) return [];

    const selector = {
      'user._id': userId,
      scope: { $ne: null }
    };

    if (roles) {
      roles = Array.isArray(roles) ? roles : [roles];
      selector['inheritedRoles._id'] = { $in: roles };
    }

    const assignments = await this.roleAssignmentCollection.find(selector, { projection: { scope: 1 } }).toArray();
    const scopes = [...new Set(assignments.map(a => a.scope))];

    return scopes;
  }

  // Add more methods as needed...
}

module.exports = Roles;

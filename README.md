# PocketBase MCP Server for Cursor AI

Integration of PocketBase with Cursor AI through the Model Context Protocol (MCP). This server allows Cursor AI to directly interact with PocketBase databases, supporting collection management, record operations, and many other functionalities.

## Features

### Collection Management
- Create and manage collections with custom schemas
- Migrate collection schemas with data preservation capabilities
- Advanced index management (create, delete, list)

### Record Operations
- CRUD operations (Create, Read, Update, Delete) for records
- Advanced querying with filtering, sorting, and aggregation
- Bulk import/export capabilities

### Cursor AI Integration
- Generate PocketBase schemas from TypeScript interfaces
- Generate TypeScript interfaces from PocketBase collections
- Analyze collection data and provide insights

## Installation

### 1. Install the npm package

```bash
npm install -g pocketbase-cursor-mcp
```

or

```bash
pnpm add -g pocketbase-cursor-mcp
```

### 2. Configuration

You can configure the PocketBase MCP Server using **environment variables** or **command line arguments**:

#### Using environment variables

Create a `.env` file in the root directory of your project:

```
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=your-admin@example.com  # Optional
POCKETBASE_ADMIN_PASSWORD=your-password        # Optional
```

#### Using command line arguments

```bash
pocketbase-cursor-mcp --url=http://127.0.0.1:8090 --admin-email=your-admin@example.com --admin-password=your-password
```

#### Available options

| Command line arg       | Environment variable       | Description                            |
|------------------------|-----------------------------|----------------------------------------|
| `--url, -u`            | `POCKETBASE_URL`           | PocketBase server URL (required)       |
| `--admin-email, -e`    | `POCKETBASE_ADMIN_EMAIL`   | Admin email (optional)                 |
| `--admin-password, -p` | `POCKETBASE_ADMIN_PASSWORD`| Admin password (optional)              |
| `--data-dir, -d`       | `POCKETBASE_DATA_DIR`      | Custom data directory path (optional)  |
| `--port`               | `PORT`                     | HTTP server port (optional)            |
| `--host`               | `HOST`                     | HTTP server host (optional)            |

Use `pocketbase-cursor-mcp --help` to view all options.

## Cursor AI Configuration

### Configure MCP in Cursor AI

1. Open Cursor AI
2. Open Settings (or press `Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
3. Select the "AI" tab
4. Scroll down to "Model Context Protocol Servers"
5. Add a new configuration with the following information:

**Name**: `pocketbase`  
**Command**: `npx`  
**Args**: `pocketbase-cursor-mcp --url=http://127.0.0.1:8090`

Or directly provide the path to the executable:

**Command**: Path to node executable (e.g., `/usr/bin/node`)  
**Args**: Path to the executable file along with parameters (e.g., `/usr/local/bin/pocketbase-cursor-mcp --url=http://127.0.0.1:8090`)

## Usage in Cursor AI

After configuration, you can use PocketBase MCP in Cursor AI by adding commands like the following to the editing interface:

```
Create a PocketBase collection from the following TypeScript interface:

interface User {
  username: string;
  email: string;
  isActive: boolean;
  age?: number;
  profile: UserProfile;
}

interface UserProfile {
  bio: string;
  avatar?: string;
  socialLinks: string[];
}
```

or

```
Generate TypeScript interfaces from the collections in my PocketBase database.
```

or 

```
Analyze the data in the "products" collection and provide insights.
```

## Available Tools

### Basic PocketBase Tools
- `create_collection`: Create a new collection
- `create_record`: Create a new record
- `list_records`: List records with optional filters
- `update_record`: Update an existing record
- `delete_record`: Delete a record
- `get_collection_schema`: Get detailed schema for a collection
- ... and many more tools

### Cursor AI Specific Tools
- `generate_pb_schema`: Generate PocketBase schema from TypeScript interfaces
- `generate_typescript_interfaces`: Generate TypeScript interfaces from PocketBase collections
- `analyze_collection_data`: Analyze data in a collection

## Usage Examples

### Creating a collection from TypeScript interface

```typescript
const schema = await mcp.use_tool("pocketbase", "generate_pb_schema", {
  sourceCode: `
    interface Product {
      name: string;
      price: number;
      description: string;
      isAvailable: boolean;
      tags: string[];
    }
  `,
  options: {
    includeTimestamps: true
  }
});

const collection = await mcp.use_tool("pocketbase", "create_collection", {
  name: "products",
  schema: schema[0].schema
});
```

### Generating TypeScript interfaces from PocketBase collections

```typescript
const interfaces = await mcp.use_tool("pocketbase", "generate_typescript_interfaces", {
  options: {
    includeRelations: true
  }
});

// Interfaces can be used in your TypeScript project
```

### Analyzing collection data

```typescript
const analysis = await mcp.use_tool("pocketbase", "analyze_collection_data", {
  collection: "products",
  options: {
    sampleSize: 500
  }
});

// View insights about your data
console.log(analysis.insights);
```

## Contributing

Contributions are always welcome! Please create an issue or pull request.

## License

MIT

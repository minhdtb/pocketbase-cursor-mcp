#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import PocketBase, {
  CollectionModel,
  CollectionIndex,
  CollectionResponse,
  SchemaField,
} from "pocketbase";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option("url", {
    alias: "u",
    type: "string",
    description: "PocketBase URL",
  })
  .option("admin-email", {
    alias: "e",
    type: "string",
    description: "Admin email for authentication",
  })
  .option("admin-password", {
    alias: "p",
    type: "string",
    description: "Admin password for authentication",
  })
  .option("data-dir", {
    alias: "d",
    type: "string",
    description: "Custom data directory path",
  })
  .option("port", {
    type: "number",
    description: "HTTP server port (if using HTTP instead of STDIO)",
  })
  .option("host", {
    type: "string",
    description: "HTTP server host (if using HTTP instead of STDIO)",
  })
  .help()
  .alias("help", "h")
  .parseSync();

// Mở rộng định nghĩa PocketBase để bao gồm thuộc tính admins
declare module "pocketbase" {
  interface PocketBase {
    admins: {
      authWithPassword(email: string, password: string): Promise<any>;
    };
  }
}

/**
 * PocketBase MCP Server for Cursor AI Integration
 *
 * This server provides MCP-compatible tools for interacting with PocketBase databases
 * and is designed to work seamlessly with Cursor AI IDE.
 */
class PocketBaseServer {
  private server: Server;
  private pb: PocketBase;

  constructor() {
    this.server = new Server(
      {
        name: "pocketbase-cursor-mcp",
        version: "0.1.1",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize PocketBase client - prioritize command line args over env vars
    const url = (argv.url as string) || process.env.POCKETBASE_URL;
    if (!url) {
      throw new Error(
        "PocketBase URL is required. Provide it via --url parameter or POCKETBASE_URL environment variable."
      );
    }
    this.pb = new PocketBase(url);

    // Optional admin auth if credentials are provided
    const adminEmail =
      (argv["admin-email"] as string) || process.env.POCKETBASE_ADMIN_EMAIL;
    const adminPassword =
      (argv["admin-password"] as string) ||
      process.env.POCKETBASE_ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      this.pb
        .collection("_superusers")
        .authWithPassword(adminEmail, adminPassword)
        .then(() => console.error("Admin authentication successful"))
        .catch((err: Error) =>
          console.error("Admin authentication failed:", err)
        );
    }

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Original PocketBase tools
        {
          name: "create_collection",
          description: "Create a new collection in PocketBase",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Collection name",
              },
              schema: {
                type: "array",
                description: "Collection schema fields",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string" },
                    required: { type: "boolean" },
                    options: { type: "object" },
                  },
                },
              },
            },
            required: ["name", "schema"],
          },
        },
        {
          name: "create_record",
          description: "Create a new record in a collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              data: {
                type: "object",
                description: "Record data",
              },
            },
            required: ["collection", "data"],
          },
        },
        {
          name: "list_records",
          description: "List records from a collection with optional filters",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              filter: {
                type: "string",
                description: "Filter query",
              },
              sort: {
                type: "string",
                description: "Sort field and direction",
              },
              page: {
                type: "number",
                description: "Page number",
              },
              perPage: {
                type: "number",
                description: "Items per page",
              },
            },
            required: ["collection"],
          },
        },
        {
          name: "update_record",
          description: "Update an existing record",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              id: {
                type: "string",
                description: "Record ID",
              },
              data: {
                type: "object",
                description: "Updated record data",
              },
            },
            required: ["collection", "id", "data"],
          },
        },
        {
          name: "delete_record",
          description: "Delete a record",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              id: {
                type: "string",
                description: "Record ID",
              },
            },
            required: ["collection", "id"],
          },
        },
        {
          name: "authenticate_user",
          description: "Authenticate a user and get auth token",
          inputSchema: {
            type: "object",
            properties: {
              email: {
                type: "string",
                description: "User email",
              },
              password: {
                type: "string",
                description: "User password",
              },
            },
            required: ["email", "password"],
          },
        },
        {
          name: "create_user",
          description: "Create a new user account",
          inputSchema: {
            type: "object",
            properties: {
              email: {
                type: "string",
                description: "User email",
              },
              password: {
                type: "string",
                description: "User password",
              },
              passwordConfirm: {
                type: "string",
                description: "Password confirmation",
              },
              name: {
                type: "string",
                description: "User name",
              },
            },
            required: ["email", "password", "passwordConfirm"],
          },
        },
        {
          name: "get_collection_schema",
          description: "Get schema details for a collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
            },
            required: ["collection"],
          },
        },
        {
          name: "backup_database",
          description: "Create a backup of the PocketBase database",
          inputSchema: {
            type: "object",
            properties: {
              format: {
                type: "string",
                enum: ["json", "csv"],
                description: "Export format (default: json)",
              },
            },
          },
        },
        {
          name: "import_data",
          description: "Import data into a collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              data: {
                type: "array",
                description: "Array of records to import",
                items: {
                  type: "object",
                },
              },
              mode: {
                type: "string",
                enum: ["create", "update", "upsert"],
                description: "Import mode (default: create)",
              },
            },
            required: ["collection", "data"],
          },
        },
        {
          name: "migrate_collection",
          description: "Migrate collection schema with data preservation",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              newSchema: {
                type: "array",
                description: "New collection schema",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string" },
                    required: { type: "boolean" },
                    options: { type: "object" },
                  },
                },
              },
              dataTransforms: {
                type: "object",
                description: "Field transformation mappings",
              },
            },
            required: ["collection", "newSchema"],
          },
        },
        {
          name: "query_collection",
          description:
            "Advanced query with filtering, sorting, and aggregation",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              filter: {
                type: "string",
                description: "Filter expression",
              },
              sort: {
                type: "string",
                description: "Sort expression",
              },
              aggregate: {
                type: "object",
                description: "Aggregation settings",
              },
              expand: {
                type: "string",
                description: "Relations to expand",
              },
            },
            required: ["collection"],
          },
        },
        {
          name: "manage_indexes",
          description: "Manage collection indexes",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name",
              },
              action: {
                type: "string",
                enum: ["create", "delete", "list"],
                description: "Action to perform",
              },
              index: {
                type: "object",
                description: "Index configuration (for create)",
                properties: {
                  name: { type: "string" },
                  fields: { type: "array", items: { type: "string" } },
                  unique: { type: "boolean" },
                },
              },
            },
            required: ["collection", "action"],
          },
        },
        // Add new Cursor AI specific tools
        {
          name: "generate_pb_schema",
          description:
            "Generate a PocketBase schema based on TypeScript interfaces or database diagram",
          inputSchema: {
            type: "object",
            properties: {
              sourceCode: {
                type: "string",
                description:
                  "TypeScript interface or database diagram to convert to PocketBase schema",
              },
              options: {
                type: "object",
                description: "Generation options",
                properties: {
                  includeAuthentication: {
                    type: "boolean",
                    description:
                      "Whether to include authentication related collections",
                  },
                  includeTimestamps: {
                    type: "boolean",
                    description:
                      "Whether to include created/updated timestamps",
                  },
                },
              },
            },
            required: ["sourceCode"],
          },
        },
        {
          name: "generate_typescript_interfaces",
          description:
            "Generate TypeScript interfaces from PocketBase collections",
          inputSchema: {
            type: "object",
            properties: {
              collections: {
                type: "array",
                description:
                  "Collection names to generate interfaces for (empty for all)",
                items: { type: "string" },
              },
              options: {
                type: "object",
                description: "Generation options",
                properties: {
                  includeRelations: {
                    type: "boolean",
                    description: "Whether to include relation types",
                  },
                },
              },
            },
          },
        },
        {
          name: "analyze_collection_data",
          description:
            "Analyze data patterns and provide insights about a collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name to analyze",
              },
              options: {
                type: "object",
                description: "Analysis options",
                properties: {
                  sampleSize: { type: "number" },
                  fields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
            required: ["collection"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          // New Cursor AI specific handlers
          case "generate_pb_schema":
            return await this.generatePbSchema(request.params.arguments);
          case "generate_typescript_interfaces":
            return await this.generateTypescriptInterfaces(
              request.params.arguments
            );
          case "analyze_collection_data":
            return await this.analyzeCollectionData(request.params.arguments);

          // Original handlers
          case "create_collection":
            return await this.createCollection(request.params.arguments);
          case "create_record":
            return await this.createRecord(request.params.arguments);
          case "list_records":
            return await this.listRecords(request.params.arguments);
          case "update_record":
            return await this.updateRecord(request.params.arguments);
          case "delete_record":
            return await this.deleteRecord(request.params.arguments);
          case "authenticate_user":
            return await this.authenticateUser(request.params.arguments);
          case "create_user":
            return await this.createUser(request.params.arguments);
          case "get_collection_schema":
            return await this.getCollectionSchema(request.params.arguments);
          case "backup_database":
            return await this.backupDatabase(request.params.arguments);
          case "import_data":
            return await this.importData(request.params.arguments);
          case "migrate_collection":
            return await this.migrateCollection(request.params.arguments);
          case "query_collection":
            return await this.queryCollection(request.params.arguments);
          case "manage_indexes":
            return await this.manageIndexes(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `PocketBase error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  }

  // New Cursor AI specific method implementations

  private async generatePbSchema(args: any) {
    try {
      const { sourceCode, options = {} } = args;

      // Logic to analyze TypeScript interface and convert to PocketBase schema
      // This is a simplified example - would be expanded in a real implementation

      const schemaAnalysis = this.analyzeTypeScriptForSchema(
        sourceCode,
        options
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(schemaAnalysis, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate schema: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private analyzeTypeScriptForSchema(sourceCode: string, options: any): any {
    // Simplified example implementation - would be more robust in production
    const collections: any[] = [];

    // Very basic regex-based parsing for interfaces
    // Note: A real implementation would use a proper TypeScript AST parser
    const interfaceMatches = sourceCode.matchAll(
      /interface\s+(\w+)\s*{([^}]*)}/gs
    );

    for (const match of interfaceMatches) {
      const name = match[1].toLowerCase();
      const interfaceBody = match[2];

      const fields: any[] = [];
      const propertyMatches = interfaceBody.matchAll(
        /(\w+)(\?)?:\s*(\w+)(\[\])?;/g
      );

      for (const propMatch of propertyMatches) {
        const fieldName = propMatch[1];
        const isOptional = !!propMatch[2];
        const fieldType = propMatch[3];
        const isArray = !!propMatch[4];

        // Map TypeScript types to PocketBase types
        let pbType = "text";
        if (fieldType === "number") pbType = "number";
        else if (fieldType === "boolean") pbType = "bool";
        else if (fieldType === "Date") pbType = "date";
        else if (isArray) pbType = "json";

        fields.push({
          name: fieldName,
          type: pbType,
          required: !isOptional,
        });
      }

      // Add authentication fields if requested
      if (
        options.includeAuthentication &&
        (name === "user" || name === "users")
      ) {
        fields.push(
          { name: "email", type: "email", required: true },
          { name: "password", type: "text", required: true }
        );
      }

      // Add timestamp fields if requested
      if (options.includeTimestamps) {
        fields.push(
          { name: "created", type: "date", required: false },
          { name: "updated", type: "date", required: false }
        );
      }

      collections.push({
        name,
        schema: fields,
      });
    }

    return collections;
  }

  private async generateTypescriptInterfaces(args: any) {
    try {
      const { collections = [], options = {} } = args;

      let collectionList: CollectionModel[];
      if (collections.length === 0) {
        // Fetch all collections if none specified
        const resp = await this.pb.collections.getList(1, 100);
        collectionList = resp.items as CollectionModel[];
      } else {
        // Fetch only specified collections
        collectionList = await Promise.all(
          collections.map((name: string) => this.pb.collections.getOne(name))
        );
      }

      // Generate TypeScript interfaces
      let typeScriptCode =
        "/**\n * PocketBase TypeScript Interfaces\n * Generated automatically\n */\n\n";

      for (const collection of collectionList) {
        typeScriptCode += `interface ${this.pascalCase(collection.name)} {\n`;

        // Add ID field
        typeScriptCode += "  id: string;\n";

        // Add schema fields
        for (const field of collection.schema) {
          const tsType = this.mapPbTypeToTsType(field.type, field.options);
          const optional = !field.required ? "?" : "";

          typeScriptCode += `  ${field.name}${optional}: ${tsType};\n`;
        }

        // Add system fields
        typeScriptCode += "  created: string;\n";
        typeScriptCode += "  updated: string;\n";

        typeScriptCode += "}\n\n";
      }

      return {
        content: [
          {
            type: "text",
            text: typeScriptCode,
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate TypeScript interfaces: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private pascalCase(str: string): string {
    return str
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  private mapPbTypeToTsType(pbType: string, options?: any): string {
    switch (pbType) {
      case "text":
      case "editor":
      case "url":
      case "email":
        return "string";
      case "number":
        return "number";
      case "bool":
        return "boolean";
      case "date":
        return "string"; // or 'Date' if processing dates
      case "json":
        return "any"; // Could be improved with generic typing
      case "relation":
        return options?.collectionId
          ? `string | ${this.pascalCase(options.collectionId)}`
          : "string";
      case "file":
      case "select":
      default:
        return "string";
    }
  }

  private async analyzeCollectionData(args: any) {
    try {
      const { collection, options = {} } = args;
      const sampleSize = options.sampleSize || 100;

      // Fetch collection schema and records
      const collectionInfo = await this.pb.collections.getOne(collection);
      const records = await this.pb
        .collection(collection)
        .getList(1, sampleSize);

      // Perform analysis
      const analysis = {
        collectionName: collection,
        recordCount: records.totalItems,
        fields: [] as any[],
        insights: [] as string[],
      };

      if (records.items.length === 0) {
        analysis.insights.push("No records available for analysis");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      }

      // Analyze each field in the schema
      for (const field of collectionInfo.schema) {
        if (options.fields && !options.fields.includes(field.name)) {
          continue; // Skip fields not in the requested list
        }

        const fieldAnalysis = {
          name: field.name,
          type: field.type,
          nonNullValues: 0,
          uniqueValues: new Set(),
          min: null as any,
          max: null as any,
        };

        // Analyze values
        for (const record of records.items) {
          const value = record[field.name];

          if (value !== null && value !== undefined) {
            fieldAnalysis.nonNullValues++;
            fieldAnalysis.uniqueValues.add(JSON.stringify(value));

            // For numeric fields, track min/max
            if (field.type === "number") {
              if (fieldAnalysis.min === null || value < fieldAnalysis.min) {
                fieldAnalysis.min = value;
              }
              if (fieldAnalysis.max === null || value > fieldAnalysis.max) {
                fieldAnalysis.max = value;
              }
            }
          }
        }

        // Calculate stats
        const processedAnalysis = {
          ...fieldAnalysis,
          uniqueValueCount: fieldAnalysis.uniqueValues.size,
          fillRate:
            (
              (fieldAnalysis.nonNullValues / records.items.length) *
              100
            ).toFixed(2) + "%",
          uniqueValues: undefined, // Remove the Set before serializing
        };

        analysis.fields.push(processedAnalysis);

        // Generate insights
        if (
          processedAnalysis.uniqueValueCount === records.items.length &&
          records.items.length > 5
        ) {
          analysis.insights.push(
            `Field '${field.name}' contains all unique values, consider using it as an identifier.`
          );
        }

        if (processedAnalysis.nonNullValues === 0) {
          analysis.insights.push(
            `Field '${field.name}' has no values. Consider removing it or ensuring it's populated.`
          );
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze collection data: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async createCollection(args: any) {
    try {
      const result = await this.pb.collections.create({
        name: args.name,
        schema: args.schema,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async createRecord(args: any) {
    try {
      const result = await this.pb
        .collection(args.collection)
        .create(args.data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create record: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async listRecords(args: any) {
    try {
      const options: any = {};
      if (args.filter) options.filter = args.filter;
      if (args.sort) options.sort = args.sort;
      if (args.page) options.page = args.page;
      if (args.perPage) options.perPage = args.perPage;

      const result = await this.pb
        .collection(args.collection)
        .getList(options.page || 1, options.perPage || 50, {
          filter: options.filter,
          sort: options.sort,
        });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list records: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async updateRecord(args: any) {
    try {
      const result = await this.pb
        .collection(args.collection)
        .update(args.id, args.data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update record: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async deleteRecord(args: any) {
    try {
      await this.pb.collection(args.collection).delete(args.id);
      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted record ${args.id} from collection ${args.collection}`,
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete record: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async authenticateUser(args: any) {
    try {
      const authData = await this.pb
        .collection("users")
        .authWithPassword(args.email, args.password);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(authData, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Authentication failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async createUser(args: any) {
    try {
      const result = await this.pb.collection("users").create({
        email: args.email,
        password: args.password,
        passwordConfirm: args.passwordConfirm,
        name: args.name,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create user: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async getCollectionSchema(args: any) {
    try {
      const collection = await this.pb.collections.getOne(args.collection);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(collection.schema, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get collection schema: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async backupDatabase(args: any) {
    try {
      const format = args.format || "json";
      const collections = await this.pb.collections.getList(1, 100);
      const backup: any = {};

      for (const collection of collections) {
        const records = await this.pb.collection(collection.name).getFullList();
        backup[collection.name] = {
          schema: collection.schema,
          records,
        };
      }

      if (format === "csv") {
        // Convert to CSV format
        let csv = "";
        for (const [collectionName, data] of Object.entries(backup) as [
          string,
          { schema: SchemaField[]; records: Record<string, any>[] }
        ][]) {
          csv += `Collection: ${collectionName}\n`;
          csv += `Schema:\n${JSON.stringify(data.schema, null, 2)}\n`;
          csv += "Records:\n";
          if (data.records.length > 0) {
            const headers = Object.keys(data.records[0]);
            csv += headers.join(",") + "\n";
            data.records.forEach((record) => {
              csv +=
                headers
                  .map((header) => JSON.stringify(record[header]))
                  .join(",") + "\n";
            });
          }
          csv += "\n";
        }
        return {
          content: [{ type: "text", text: csv }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(backup, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to backup database: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async importData(args: any) {
    try {
      const mode = args.mode || "create";
      const collection = this.pb.collection(args.collection);
      const results = [];

      for (const record of args.data) {
        let result;
        switch (mode) {
          case "create":
            result = await collection.create(record);
            break;
          case "update":
            if (!record.id) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Record ID required for update mode"
              );
            }
            result = await collection.update(record.id, record);
            break;
          case "upsert":
            if (record.id) {
              try {
                result = await collection.update(record.id, record);
              } catch {
                result = await collection.create(record);
              }
            } else {
              result = await collection.create(record);
            }
            break;
          default:
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid import mode: ${mode}`
            );
        }
        results.push(result);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to import data: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async migrateCollection(args: any) {
    try {
      // Create new collection with temporary name
      const tempName = `${args.collection}_migration_${Date.now()}`;
      await this.pb.collections.create({
        name: tempName,
        schema: args.newSchema,
      });

      // Get all records from old collection
      const oldRecords = await this.pb
        .collection(args.collection)
        .getFullList();

      // Transform and import records to new collection
      const transformedRecords = oldRecords.map((record) => {
        const newRecord: any = { ...record };
        if (args.dataTransforms) {
          for (const [field, transform] of Object.entries(
            args.dataTransforms
          )) {
            try {
              // Safely evaluate the transform expression
              newRecord[field] = new Function(
                "oldValue",
                `return ${transform}`
              )(record[field]);
            } catch (e) {
              console.error(`Failed to transform field ${field}:`, e);
            }
          }
        }
        return newRecord;
      });

      for (const record of transformedRecords) {
        await this.pb.collection(tempName).create(record);
      }

      // Delete old collection
      await this.pb.collections.delete(args.collection);

      // Rename temp collection to original name
      const renamedCollection = await this.pb.collections.update(tempName, {
        name: args.collection,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(renamedCollection, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to migrate collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async queryCollection(args: any) {
    try {
      const collection = this.pb.collection(args.collection);
      const options: any = {};

      if (args.filter) options.filter = args.filter;
      if (args.sort) options.sort = args.sort;
      if (args.expand) options.expand = args.expand;

      const records = (await collection.getList(
        1,
        100,
        options
      )) as CollectionResponse;
      records[Symbol.iterator] = function* () {
        yield* this.items;
      };

      let result: any = { items: records.items };

      if (args.aggregate) {
        const aggregations: any = {};
        for (const [name, expr] of Object.entries(args.aggregate)) {
          const [func, field] = (expr as string).split("(");
          const cleanField = field.replace(")", "");

          switch (func) {
            case "sum":
              aggregations[name] = records.items.reduce(
                (sum: number, record: any) =>
                  sum + (parseFloat(record[cleanField]) || 0),
                0
              );
              break;
            case "avg":
              aggregations[name] =
                records.items.reduce(
                  (sum: number, record: any) =>
                    sum + (parseFloat(record[cleanField]) || 0),
                  0
                ) / records.items.length;
              break;
            case "count":
              aggregations[name] = records.items.length;
              break;
            default:
              throw new McpError(
                ErrorCode.InvalidParams,
                `Unsupported aggregation function: ${func}`
              );
          }
        }
        result.aggregations = aggregations;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to query collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async manageIndexes(args: any) {
    try {
      const collection = (await this.pb.collections.getOne(
        args.collection
      )) as CollectionModel;
      const currentIndexes: CollectionIndex[] = collection.indexes || [];
      let result;

      switch (args.action) {
        case "create":
          if (!args.index) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Index configuration required for create action"
            );
          }
          const updatedCollection = await this.pb.collections.update(
            collection.id,
            {
              ...collection,
              indexes: [...currentIndexes, args.index as CollectionIndex],
            }
          );
          result = updatedCollection.indexes;
          break;

        case "delete":
          if (!args.index?.name) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Index name required for delete action"
            );
          }
          const filteredIndexes = currentIndexes.filter(
            (idx) => idx.name !== args.index.name
          );
          const collectionAfterDelete = await this.pb.collections.update(
            collection.id,
            {
              ...collection,
              indexes: filteredIndexes,
            }
          );
          result = collectionAfterDelete.indexes;
          break;

        case "list":
          result = currentIndexes;
          break;

        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid index action: ${args.action}`
          );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage indexes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("PocketBase MCP server running on stdio");
    console.error("Ready for Cursor AI integration");
  }
}

// Run the server
const server = new PocketBaseServer();
server.run().catch(console.error);

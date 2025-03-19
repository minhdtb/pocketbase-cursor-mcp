#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import PocketBase, { CollectionModel, SchemaField } from "pocketbase";
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
        .authWithPassword(adminEmail, adminPassword, {
          // Set a reasonable auto refresh threshold (30 minutes)
          autoRefreshThreshold: 1800,
        })
        .then(async () => {
          console.error("Admin authentication successful");
        })
        .catch((err: Error) => {
          console.error("Admin authentication failed:", err);
          // Continue running even if admin auth fails
          // This allows using the server with limited permissions
        });
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
              type: {
                type: "string",
                description: "Collection type (base, auth, view)",
                enum: ["base", "auth", "view"],
                default: "base",
              },
              fields: {
                type: "array",
                description: "Collection fields configuration",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Field name" },
                    type: {
                      type: "string",
                      description: "Field type",
                      enum: [
                        "text",
                        "number",
                        "bool",
                        "email",
                        "url",
                        "date",
                        "select",
                        "relation",
                        "file",
                        "json",
                        "editor",
                        "autodate",
                      ],
                    },
                    required: {
                      type: "boolean",
                      description: "Whether the field is required",
                    },
                    system: {
                      type: "boolean",
                      description: "Whether this is a system field",
                    },
                    unique: {
                      type: "boolean",
                      description:
                        "Whether the field should have unique values",
                    },
                    // TextField options
                    min: {
                      type: "number",
                      description: "Minimum text length or numeric value",
                    },
                    max: {
                      type: "number",
                      description: "Maximum text length or numeric value",
                    },
                    pattern: {
                      type: "string",
                      description: "Validation regex pattern for text fields",
                    },
                    autogeneratePattern: {
                      type: "string",
                      description:
                        "Pattern for autogenerating field values (for text fields)",
                    },
                    // SelectField options
                    options: {
                      type: "object",
                      description: "Field-specific options",
                      properties: {
                        values: {
                          type: "array",
                          description: "Predefined values for select fields",
                          items: {
                            type: "string",
                          },
                        },
                        maxSelect: {
                          type: "number",
                          description: "Maximum number of selectable options",
                        },
                      },
                    },
                    // RelationField options
                    collectionId: {
                      type: "string",
                      description: "Target collection ID for relation fields",
                    },
                    cascadeDelete: {
                      type: "boolean",
                      description:
                        "Whether to delete related records when the parent is deleted",
                    },
                    maxSelect: {
                      type: "number",
                      description:
                        "Maximum number of relations (1 for single relation, > 1 for multiple)",
                    },
                    // AutodateField options
                    onCreate: {
                      type: "boolean",
                      description:
                        "Whether to set date on record creation (for autodate fields)",
                    },
                    onUpdate: {
                      type: "boolean",
                      description:
                        "Whether to update date on record update (for autodate fields)",
                    },
                    presentable: {
                      type: "boolean",
                      description:
                        "Whether the field can be used as a presentable field in the UI",
                    },
                    hidden: {
                      type: "boolean",
                      description: "Whether the field is hidden in the UI",
                    },
                  },
                  required: ["name", "type"],
                },
              },
              listRule: {
                type: "string",
                description: "Rule for listing records",
              },
              viewRule: {
                type: "string",
                description: "Rule for viewing records",
              },
              createRule: {
                type: "string",
                description: "Rule for creating records",
              },
              updateRule: {
                type: "string",
                description: "Rule for updating records",
              },
              deleteRule: {
                type: "string",
                description: "Rule for deleting records",
              },
              indexes: {
                type: "array",
                items: { type: "string" },
                description: "Collection indexes",
              },
              viewQuery: {
                type: "string",
                description: "SQL query for view collections",
              },
              passwordAuth: {
                type: "object",
                description:
                  "Password authentication settings for auth collections",
                properties: {
                  enabled: { type: "boolean" },
                  identityFields: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
            required: ["name", "fields"],
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
                description:
                  "Record data with field values matching the collection schema",
              },
              expand: {
                type: "string",
                description:
                  "Comma-separated list of relation fields to expand in the response (e.g. 'author,comments.user')",
              },
              fields: {
                type: "string",
                description:
                  "Comma-separated fields to return in the response (e.g. 'id,title,author')",
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
                description:
                  "Filter query using PocketBase filter syntax (e.g. 'status = true && created > \"2022-08-01 10:00:00\"')",
              },
              sort: {
                type: "string",
                description:
                  "Sort field and direction (e.g. '-created,title' for descending created date followed by ascending title)",
              },
              page: {
                type: "number",
                description: "Page number for pagination (default: 1)",
              },
              perPage: {
                type: "number",
                description: "Items per page (default: 50, max: 500)",
              },
              expand: {
                type: "string",
                description:
                  "Comma-separated list of relation fields to expand (e.g. 'author,comments.user')",
              },
              fields: {
                type: "string",
                description:
                  "Comma-separated fields to return in the response (e.g. 'id,title,author')",
              },
              skipTotal: {
                type: "boolean",
                description:
                  "If set to true, the total count query will be skipped to improve performance",
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
                description:
                  "Updated record data with field values matching the collection schema. Can use field modifiers like fieldName+, +fieldName, fieldName-.",
              },
              expand: {
                type: "string",
                description:
                  "Comma-separated list of relation fields to expand in the response (e.g. 'author,comments.user')",
              },
              fields: {
                type: "string",
                description:
                  "Comma-separated fields to return in the response (e.g. 'id,title,author')",
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
              collection: {
                type: "string",
                description: "Auth collection name (default: 'users')",
              },
              email: {
                type: "string",
                description: "User email or identity field value",
              },
              password: {
                type: "string",
                description: "User password",
              },
              autoRefreshThreshold: {
                type: "number",
                description:
                  "Time in seconds that will trigger token auto refresh before its expiration (default: 30 minutes)",
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
              collection: {
                type: "string",
                description: "Auth collection name (default: 'users')",
              },
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
                description: "Password confirmation (must match password)",
              },
              verified: {
                type: "boolean",
                description: "Whether the user is verified (default: false)",
              },
              emailVisibility: {
                type: "boolean",
                description:
                  "Whether the user email is publicly visible (default: false)",
              },
              additionalData: {
                type: "object",
                description:
                  "Additional user data fields specific to your auth collection",
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
          name: "delete_collection",
          description: "Delete a collection from PocketBase",
          inputSchema: {
            type: "object",
            properties: {
              collection: {
                type: "string",
                description: "Collection name or ID to delete",
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
              fields: {
                type: "array",
                description: "New collection fields configuration",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Field name" },
                    type: {
                      type: "string",
                      description: "Field type",
                      enum: [
                        "text",
                        "number",
                        "bool",
                        "email",
                        "url",
                        "date",
                        "select",
                        "relation",
                        "file",
                        "json",
                        "editor",
                        "autodate",
                      ],
                    },
                    required: {
                      type: "boolean",
                      description: "Whether the field is required",
                    },
                    options: {
                      type: "object",
                      description: "Field-specific options",
                    },
                    // Include additional field properties as needed
                  },
                  required: ["name", "type"],
                },
              },
              dataTransforms: {
                type: "object",
                description:
                  "Field transformation mappings for converting old field values to new ones",
              },
              name: {
                type: "string",
                description:
                  "Optional new collection name if you want to rename the collection",
              },
              listRule: {
                type: "string",
                description: "Optional new rule for listing records",
              },
              viewRule: {
                type: "string",
                description: "Optional new rule for viewing records",
              },
              createRule: {
                type: "string",
                description: "Optional new rule for creating records",
              },
              updateRule: {
                type: "string",
                description: "Optional new rule for updating records",
              },
              deleteRule: {
                type: "string",
                description: "Optional new rule for deleting records",
              },
            },
            required: ["collection", "fields"],
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
          case "delete_collection":
            return await this.deleteCollection(request.params.arguments);
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

        // Add fields from the collection
        const fields = collection.fields || [];
        for (const field of fields) {
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

      // Fetch collection and records
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

      // Extract fields from the collection object
      const fields = collectionInfo.fields || [];

      // Analyze each field
      for (const field of fields) {
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
      // Pass the args directly to the PocketBase SDK
      // The sdk expects 'fields' parameter as per the documentation
      const result = await this.pb.collections.create({
        ...args,
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create collection: ${errorMessage}`
      );
    }
  }

  private async createRecord(args: any) {
    try {
      const options: any = {};

      // Add optional parameters if provided
      if (args.expand) options.expand = args.expand;
      if (args.fields) options.fields = args.fields;

      const result = await this.pb
        .collection(args.collection)
        .create(args.data, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create record: ${errorMessage}`
      );
    }
  }

  private async listRecords(args: any) {
    try {
      const options: any = {};

      // Add all optional parameters if provided
      if (args.filter) options.filter = args.filter;
      if (args.sort) options.sort = args.sort;
      if (args.expand) options.expand = args.expand;
      if (args.fields) options.fields = args.fields;
      if (args.skipTotal !== undefined) options.skipTotal = args.skipTotal;

      // Get page and perPage with defaults
      const page = args.page || 1;
      const perPage = args.perPage || 50;

      const result = await this.pb
        .collection(args.collection)
        .getList(page, perPage, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list records: ${errorMessage}`
      );
    }
  }

  private async updateRecord(args: any) {
    try {
      const options: any = {};

      // Add optional parameters if provided
      if (args.expand) options.expand = args.expand;
      if (args.fields) options.fields = args.fields;

      const result = await this.pb
        .collection(args.collection)
        .update(args.id, args.data, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update record: ${errorMessage}`
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete record: ${errorMessage}`
      );
    }
  }

  private async authenticateUser(args: any) {
    try {
      const collectionName = args.collection || "users";
      const authOptions: any = {};

      // Check if autoRefreshThreshold is provided
      if (args.autoRefreshThreshold) {
        // authWithPassword accepts an options object with autoRefreshThreshold
        // This will trigger auto refresh or auto reauthentication in case
        // the token has expired or is going to expire in the next X seconds.
        authOptions.autoRefreshThreshold = args.autoRefreshThreshold;
      }

      const authData = await this.pb
        .collection(collectionName)
        .authWithPassword(args.email, args.password, authOptions);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(authData, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Authentication failed: ${errorMessage}`
      );
    }
  }

  private async createUser(args: any) {
    try {
      const collectionName = args.collection || "users";

      // Prepare user data
      const userData: any = {
        email: args.email,
        password: args.password,
        passwordConfirm: args.passwordConfirm,
      };

      // Add optional fields if provided
      if (args.verified !== undefined) {
        userData.verified = args.verified;
      }

      if (args.emailVisibility !== undefined) {
        userData.emailVisibility = args.emailVisibility;
      }

      // Add any additional data fields
      if (args.additionalData) {
        Object.assign(userData, args.additionalData);
      }

      const result = await this.pb.collection(collectionName).create(userData);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create user: ${errorMessage}`
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
            text: JSON.stringify(collection, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get collection schema: ${errorMessage}`
      );
    }
  }

  private async deleteCollection(args: any) {
    try {
      const collection = await this.pb.collections.getOne(args.collection);
      await this.pb.collections.delete(collection.id);

      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted collection "${args.collection}"`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete collection: ${errorMessage}`
      );
    }
  }

  private async backupDatabase(args: any) {
    try {
      const format = args.format || "json";
      const collections = await this.pb.collections.getFullList();
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to backup database: ${errorMessage}`
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to import data: ${errorMessage}`
      );
    }
  }

  private async migrateCollection(args: any) {
    try {
      // Create new collection with temporary name
      const tempName = `${args.collection}_migration_${Date.now()}`;

      // Create a configuration object for the temporary collection
      const collectionConfig: any = {
        name: tempName,
        fields: args.fields,
      };

      // Add optional collection configuration if provided
      if (args.listRule !== undefined)
        collectionConfig.listRule = args.listRule;
      if (args.viewRule !== undefined)
        collectionConfig.viewRule = args.viewRule;
      if (args.createRule !== undefined)
        collectionConfig.createRule = args.createRule;
      if (args.updateRule !== undefined)
        collectionConfig.updateRule = args.updateRule;
      if (args.deleteRule !== undefined)
        collectionConfig.deleteRule = args.deleteRule;

      // Create the temporary collection
      await this.pb.collections.create(collectionConfig);

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

      // Create records in the temporary collection
      for (const record of transformedRecords) {
        await this.pb.collection(tempName).create(record);
      }

      // Delete old collection
      await this.pb.collections.delete(args.collection);

      // Determine the final name for the collection
      const finalName = args.name || args.collection;

      // Rename temp collection to the final name
      const renamedCollection = await this.pb.collections.update(tempName, {
        name: finalName,
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to migrate collection: ${errorMessage}`
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

      const records = await collection.getList(1, 100, options);

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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to query collection: ${errorMessage}`
      );
    }
  }

  private async manageIndexes(args: any) {
    try {
      const collection = await this.pb.collections.getOne(args.collection);
      const currentIndexes: string[] = collection.indexes || [];
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
              indexes: [...currentIndexes, args.index],
            }
          );
          result = updatedCollection.indexes;
          break;

        case "delete":
          if (!args.index) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Index name required for delete action"
            );
          }
          const filteredIndexes = currentIndexes.filter(
            (idx) => idx !== args.index
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
      const errorMessage = JSON.stringify(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage indexes: ${errorMessage}`
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
console.log("Starting PocketBase MCP server...");
const server = new PocketBaseServer();
server.run().catch(console.error);

# PocketBase MCP Server for Cursor AI

Tích hợp PocketBase với Cursor AI thông qua giao thức Model Context Protocol (MCP). Server này cho phép Cursor AI tương tác trực tiếp với cơ sở dữ liệu PocketBase, hỗ trợ quản lý bộ sưu tập, bản ghi và nhiều thao tác khác.

## Tính năng

### Quản lý bộ sưu tập (Collection Management)
- Tạo và quản lý bộ sưu tập với lược đồ tùy chỉnh
- Di chuyển lược đồ bộ sưu tập với khả năng bảo toàn dữ liệu
- Quản lý chỉ mục nâng cao (tạo, xóa, liệt kê)

### Thao tác với bản ghi (Record Operations)
- Thao tác CRUD (Create, Read, Update, Delete) cho bản ghi
- Truy vấn nâng cao với lọc, sắp xếp và tổng hợp
- Khả năng nhập/xuất hàng loạt

### Tích hợp với Cursor AI
- Tạo lược đồ PocketBase từ các interface TypeScript
- Tạo interface TypeScript từ các bộ sưu tập PocketBase
- Phân tích dữ liệu bộ sưu tập và cung cấp insights

## Cài đặt

### 1. Cài đặt gói npm

```bash
npm install -g pocketbase-cursor-mcp
```

hoặc 

```bash
pnpm add -g pocketbase-cursor-mcp
```

### 2. Cấu hình

Bạn có thể cấu hình PocketBase MCP Server bằng **biến môi trường** hoặc **command line arguments**:

#### Sử dụng biến môi trường

Tạo file `.env` trong thư mục gốc của dự án:

```
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=your-admin@example.com  # Tùy chọn
POCKETBASE_ADMIN_PASSWORD=your-password        # Tùy chọn
```

#### Sử dụng command line arguments

```bash
pocketbase-cursor-mcp --url=http://127.0.0.1:8090 --admin-email=your-admin@example.com --admin-password=your-password
```

#### Các options có sẵn

| Command line arg       | Biến môi trường            | Mô tả                                   |
|------------------------|----------------------------|----------------------------------------|
| `--url, -u`            | `POCKETBASE_URL`           | URL của PocketBase server (bắt buộc)    |
| `--admin-email, -e`    | `POCKETBASE_ADMIN_EMAIL`   | Email admin (tùy chọn)                  |
| `--admin-password, -p` | `POCKETBASE_ADMIN_PASSWORD`| Mật khẩu admin (tùy chọn)              |
| `--data-dir, -d`       | `POCKETBASE_DATA_DIR`      | Đường dẫn thư mục dữ liệu (tùy chọn)    |
| `--port`               | `PORT`                     | Port cho HTTP server (tùy chọn)        |
| `--host`               | `HOST`                     | Host cho HTTP server (tùy chọn)         |

Sử dụng `pocketbase-cursor-mcp --help` để xem tất cả các tùy chọn.

## Cấu hình cho Cursor AI

### Cấu hình MCP trong Cursor AI

1. Mở Cursor AI
2. Mở Settings (hoặc nhấn `Cmd+,` trên macOS, `Ctrl+,` trên Windows/Linux)
3. Chọn tab "AI"
4. Cuộn xuống đến phần "Model Context Protocol Servers"
5. Thêm cấu hình mới với các thông tin sau:

**Name**: `pocketbase`  
**Command**: `npx`  
**Args**: `pocketbase-cursor-mcp --url=http://127.0.0.1:8090`

Hoặc trực tiếp cung cấp đường dẫn đến file thực thi:

**Command**: Đường dẫn đến node executable (ví dụ: `/usr/bin/node`)  
**Args**: Đường dẫn đến file thực thi cùng với các tham số (ví dụ: `/usr/local/bin/pocketbase-cursor-mcp --url=http://127.0.0.1:8090`)

## Sử dụng trong Cursor AI

Sau khi cấu hình, bạn có thể sử dụng PocketBase MCP trong Cursor AI bằng cách thêm lệnh như sau vào giao diện soạn thảo:

```
Tạo một bộ sưu tập PocketBase từ interface TypeScript sau:

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

hoặc

```
Tạo TypeScript interfaces từ các bộ sưu tập trong cơ sở dữ liệu PocketBase của tôi.
```

hoặc 

```
Phân tích dữ liệu trong bộ sưu tập "products" và cung cấp insights.
```

## Các công cụ có sẵn

### Công cụ PocketBase cơ bản
- `create_collection`: Tạo bộ sưu tập mới
- `create_record`: Tạo bản ghi mới
- `list_records`: Liệt kê bản ghi với bộ lọc tùy chọn
- `update_record`: Cập nhật bản ghi hiện có
- `delete_record`: Xóa bản ghi
- `get_collection_schema`: Lấy lược đồ chi tiết của bộ sưu tập
- ... và nhiều công cụ khác

### Công cụ dành riêng cho Cursor AI
- `generate_pb_schema`: Tạo lược đồ PocketBase từ interface TypeScript
- `generate_typescript_interfaces`: Tạo TypeScript interfaces từ bộ sưu tập PocketBase
- `analyze_collection_data`: Phân tích dữ liệu trong bộ sưu tập

## Ví dụ sử dụng

### Tạo bộ sưu tập từ interface TypeScript

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

### Tạo TypeScript interfaces từ bộ sưu tập PocketBase

```typescript
const interfaces = await mcp.use_tool("pocketbase", "generate_typescript_interfaces", {
  options: {
    includeRelations: true
  }
});

// Interfaces có thể được sử dụng trong dự án TypeScript của bạn
```

### Phân tích dữ liệu bộ sưu tập

```typescript
const analysis = await mcp.use_tool("pocketbase", "analyze_collection_data", {
  collection: "products",
  options: {
    sampleSize: 500
  }
});

// Xem insights về dữ liệu của bạn
console.log(analysis.insights);
```

## Đóng góp

Đóng góp luôn được hoan nghênh! Vui lòng tạo issue hoặc pull request.

## Giấy phép

MIT

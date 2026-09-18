package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type PostgresConnection struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSLMode  string `json:"sslmode"`
}

type PostgresColumn struct {
	Name     string `json:"name"`
	DataType string `json:"data_type"`
	Nullable bool   `json:"nullable"`
}
type PostgresTable struct {
	Schema  string           `json:"schema"`
	Name    string           `json:"name"`
	Type    string           `json:"type"`
	Columns []PostgresColumn `json:"columns"`
}
type PostgresCatalog struct {
	Database string          `json:"database"`
	Version  string          `json:"version"`
	Tables   []PostgresTable `json:"tables"`
}
type PostgresQueryResult struct {
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"row_count"`
	Truncated  bool     `json:"truncated"`
	DurationMS int64    `json:"duration_ms"`
}

func (s *Service) TestPostgres(ctx context.Context, connection PostgresConnection) error {
	db, err := openPostgres(connection)
	if err != nil {
		return err
	}
	defer db.Close()
	probe, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	return db.PingContext(probe)
}

func (s *Service) InspectPostgres(ctx context.Context, connection PostgresConnection) (PostgresCatalog, error) {
	db, err := openPostgres(connection)
	if err != nil {
		return PostgresCatalog{}, err
	}
	defer db.Close()
	probe, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var catalog PostgresCatalog
	if err := db.QueryRowContext(probe, `SELECT current_database(), version()`).Scan(&catalog.Database, &catalog.Version); err != nil {
		return catalog, err
	}
	rows, err := db.QueryContext(probe, `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name`)
	if err != nil {
		return catalog, err
	}
	indexes := map[string]int{}
	for rows.Next() {
		var table PostgresTable
		if err := rows.Scan(&table.Schema, &table.Name, &table.Type); err != nil {
			rows.Close()
			return catalog, err
		}
		table.Columns = []PostgresColumn{}
		indexes[table.Schema+"\x00"+table.Name] = len(catalog.Tables)
		catalog.Tables = append(catalog.Tables, table)
	}
	if err := rows.Close(); err != nil {
		return catalog, err
	}
	columns, err := db.QueryContext(probe, `SELECT table_schema, table_name, column_name, data_type, is_nullable = 'YES' FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position`)
	if err != nil {
		return catalog, err
	}
	for columns.Next() {
		var schema, tableName string
		var column PostgresColumn
		if err := columns.Scan(&schema, &tableName, &column.Name, &column.DataType, &column.Nullable); err != nil {
			columns.Close()
			return catalog, err
		}
		if index, ok := indexes[schema+"\x00"+tableName]; ok {
			catalog.Tables[index].Columns = append(catalog.Tables[index].Columns, column)
		}
	}
	if err := columns.Close(); err != nil {
		return catalog, err
	}
	if catalog.Tables == nil {
		catalog.Tables = []PostgresTable{}
	}
	return catalog, nil
}

func (s *Service) QueryPostgres(ctx context.Context, connection PostgresConnection, statement string, readOnly bool) (PostgresQueryResult, error) {
	return s.queryPostgresWithLimits(ctx, connection, statement, readOnly, 30*time.Second, 500)
}

func (s *Service) queryPostgresWithLimits(ctx context.Context, connection PostgresConnection, statement string, readOnly bool, timeout time.Duration, maxRows int) (PostgresQueryResult, error) {
	statement = strings.TrimSpace(statement)
	if statement == "" {
		return PostgresQueryResult{}, errors.New("SQL statement is required")
	}
	if len(statement) > 64<<10 {
		return PostgresQueryResult{}, errors.New("SQL statement exceeds 64 KiB limit")
	}
	if timeout <= 0 || timeout > 5*time.Minute {
		return PostgresQueryResult{}, errors.New("SQL timeout must be between 1s and 5m")
	}
	if maxRows < 1 || maxRows > 5000 {
		return PostgresQueryResult{}, errors.New("SQL max rows must be between 1 and 5000")
	}
	db, err := openPostgres(connection)
	if err != nil {
		return PostgresQueryResult{}, err
	}
	defer db.Close()
	queryCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tx, err := db.BeginTx(queryCtx, &sql.TxOptions{ReadOnly: readOnly})
	if err != nil {
		return PostgresQueryResult{}, err
	}
	defer tx.Rollback()
	if readOnly {
		if _, err := tx.ExecContext(queryCtx, `SET LOCAL default_transaction_read_only = on`); err != nil {
			return PostgresQueryResult{}, err
		}
	}
	if _, err := tx.ExecContext(queryCtx, fmt.Sprintf(`SET LOCAL statement_timeout = %d`, timeout.Milliseconds())); err != nil {
		return PostgresQueryResult{}, err
	}
	if _, err := tx.ExecContext(queryCtx, `SET LOCAL lock_timeout = 3000`); err != nil {
		return PostgresQueryResult{}, err
	}
	started := time.Now()
	rows, err := tx.QueryContext(queryCtx, statement)
	if err != nil {
		return PostgresQueryResult{}, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return PostgresQueryResult{}, err
	}
	result := PostgresQueryResult{Columns: columns, Rows: [][]any{}}
	for rows.Next() {
		if len(result.Rows) >= maxRows {
			result.Truncated = true
			break
		}
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return result, err
		}
		for i := range values {
			values[i] = normalizeDatabaseValue(values[i])
		}
		result.Rows = append(result.Rows, values)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if err := rows.Close(); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	result.RowCount = len(result.Rows)
	result.DurationMS = time.Since(started).Milliseconds()
	return result, nil
}

// SetInternalPostgresConnectionURL exposes the engine-owned Wharnex database to
// interactive/v2 through a stable handle. The DSN and password never cross the
// planner protocol; only the literal handle "wharnex-internal" does.
func (s *Service) SetInternalPostgresConnectionURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	password, _ := parsed.User.Password()
	port, _ := strconv.Atoi(parsed.Port())
	ssl := parsed.Query().Get("sslmode")
	if ssl == "" {
		ssl = "prefer"
	}
	connection := PostgresConnection{
		Host: parsed.Hostname(), Port: port, Database: strings.TrimPrefix(parsed.Path, "/"),
		User: parsed.User.Username(), Password: password, SSLMode: ssl,
	}
	if _, err := postgresDSN(connection); err != nil {
		return fmt.Errorf("internal postgres handle: %w", err)
	}
	s.interactiveDBMu.Lock()
	s.interactiveDB["wharnex-internal"] = connection
	s.interactiveDBMu.Unlock()
	return nil
}

func (s *Service) registerInteractivePostgresConnection(id string, connection PostgresConnection) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("connection id is required")
	}
	if _, err := postgresDSN(connection); err != nil {
		return err
	}
	s.interactiveDBMu.Lock()
	s.interactiveDB[id] = connection
	s.interactiveDBMu.Unlock()
	return nil
}

func (s *Service) interactivePostgresConnection(id string) (PostgresConnection, bool) {
	s.interactiveDBMu.RLock()
	defer s.interactiveDBMu.RUnlock()
	connection, ok := s.interactiveDB[strings.TrimSpace(id)]
	return connection, ok
}

func openPostgres(connection PostgresConnection) (*sql.DB, error) {
	dsn, err := postgresDSN(connection)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(0)
	db.SetConnMaxLifetime(time.Minute)
	return db, nil
}

func postgresDSN(connection PostgresConnection) (string, error) {
	host := strings.TrimSpace(connection.Host)
	database := strings.TrimSpace(connection.Database)
	user := strings.TrimSpace(connection.User)
	if host == "" || database == "" || user == "" {
		return "", errors.New("host, database and user are required")
	}
	port := connection.Port
	if port == 0 {
		port = 5432
	}
	if port < 1 || port > 65535 {
		return "", errors.New("port must be between 1 and 65535")
	}
	ssl := strings.TrimSpace(connection.SSLMode)
	if ssl == "" {
		ssl = "prefer"
	}
	allowed := map[string]bool{"disable": true, "allow": true, "prefer": true, "require": true, "verify-ca": true, "verify-full": true}
	if !allowed[ssl] {
		return "", fmt.Errorf("unsupported sslmode %q", ssl)
	}
	target := &url.URL{Scheme: "postgres", Host: host + ":" + strconv.Itoa(port), Path: "/" + database, RawQuery: url.Values{"sslmode": []string{ssl}}.Encode()}
	target.User = url.UserPassword(user, connection.Password)
	return target.String(), nil
}

func normalizeDatabaseValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format(time.RFC3339Nano)
	default:
		return typed
	}
}

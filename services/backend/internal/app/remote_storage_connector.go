package app

import "context"

type RemoteStorageField struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
	Required    bool   `json:"required,omitempty"`
	Advanced    bool   `json:"advanced,omitempty"`
}

type RemoteStorageProvider struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	AuthMode    string               `json:"auth_mode"`
	Available   bool                 `json:"available"`
	Fields      []RemoteStorageField `json:"fields"`
}

type RemoteStorageConnectionRequest struct {
	InstanceID string            `json:"instance_id"`
	Provider   string            `json:"provider"`
	Fields     map[string]string `json:"fields"`
}

type RemoteStorageConnection struct {
	Provider    string `json:"provider"`
	Remote      string `json:"remote"`
	Connected   bool   `json:"connected"`
	DisplayName string `json:"display_name,omitempty"`
}

type RemoteStorageConnector interface {
	Providers(context.Context) []RemoteStorageProvider
	Connect(context.Context, RemoteStorageConnectionRequest) (RemoteStorageConnection, error)
	Disconnect(context.Context, string) error
	Check(context.Context, string) error
}

func (s *Service) SetRemoteStorageConnector(connector RemoteStorageConnector) {
	s.remoteStorageConnector = connector
}

func (s *Service) RemoteStorageProviders(ctx context.Context) []RemoteStorageProvider {
	if s.remoteStorageConnector == nil {
		return nil
	}
	return s.remoteStorageConnector.Providers(ctx)
}

func (s *Service) ConnectRemoteStorage(ctx context.Context, request RemoteStorageConnectionRequest) (RemoteStorageConnection, error) {
	if s.remoteStorageConnector == nil {
		return RemoteStorageConnection{}, ErrRemoteStorageConnectorUnavailable
	}
	return s.remoteStorageConnector.Connect(ctx, request)
}

func (s *Service) DisconnectRemoteStorage(ctx context.Context, remote string) error {
	if s.remoteStorageConnector == nil {
		return ErrRemoteStorageConnectorUnavailable
	}
	return s.remoteStorageConnector.Disconnect(ctx, remote)
}

func (s *Service) CheckRemoteStorage(ctx context.Context, remote string) error {
	if s.remoteStorageConnector == nil {
		return ErrRemoteStorageConnectorUnavailable
	}
	return s.remoteStorageConnector.Check(ctx, remote)
}

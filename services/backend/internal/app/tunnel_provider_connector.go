package app

import "context"

type TunnelProviderEnrollmentRequest struct {
	InstanceID string            `json:"instance_id"`
	Provider   string            `json:"provider"`
	Fields     map[string]string `json:"fields"`
}

type TunnelProviderEnrollment struct {
	Provider      string `json:"provider"`
	CredentialRef string `json:"credential_ref"`
	PublicURL     string `json:"public_url"`
	LocalPort     int    `json:"local_port,omitempty"`
}

type TunnelProviderConnector interface {
	Enroll(context.Context, TunnelProviderEnrollmentRequest) (TunnelProviderEnrollment, error)
	Disconnect(context.Context, string) error
}

func (s *Service) SetTunnelProviderConnector(connector TunnelProviderConnector) {
	s.tunnelProviderConnector = connector
}

func (s *Service) EnrollTunnelProvider(ctx context.Context, request TunnelProviderEnrollmentRequest) (TunnelProviderEnrollment, error) {
	if s.tunnelProviderConnector == nil {
		return TunnelProviderEnrollment{}, ErrTunnelProviderConnectorUnavailable
	}
	return s.tunnelProviderConnector.Enroll(ctx, request)
}

func (s *Service) DisconnectTunnelProvider(ctx context.Context, credentialRef string) error {
	if s.tunnelProviderConnector == nil {
		return ErrTunnelProviderConnectorUnavailable
	}
	return s.tunnelProviderConnector.Disconnect(ctx, credentialRef)
}

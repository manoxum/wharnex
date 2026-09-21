package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	ErrDockerUnavailable        = errors.New("docker daemon is unavailable")
	ErrDockerProtectedContainer = errors.New("the Wharnex backend container cannot control itself")
)

const dockerServicesTimeout = 12 * time.Second

var dockerIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

type DockerContainer struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Image     string `json:"image"`
	State     string `json:"state"`
	Status    string `json:"status"`
	Ports     string `json:"ports,omitempty"`
	Networks  string `json:"networks,omitempty"`
	Protected bool   `json:"protected,omitempty"`
}

type DockerImage struct {
	ID           string `json:"id"`
	Repository   string `json:"repository"`
	Tag          string `json:"tag"`
	Size         string `json:"size"`
	CreatedSince string `json:"created_since,omitempty"`
}

type DockerVolume struct {
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Mountpoint string `json:"mountpoint,omitempty"`
	Scope      string `json:"scope,omitempty"`
}

type DockerNetwork struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Scope    string `json:"scope,omitempty"`
	Internal bool   `json:"internal,omitempty"`
}

type DockerOverview struct {
	Containers  []DockerContainer `json:"containers"`
	Images      []DockerImage     `json:"images"`
	Volumes     []DockerVolume    `json:"volumes"`
	Networks    []DockerNetwork   `json:"networks"`
	RefreshedAt time.Time         `json:"refreshed_at"`
}

type DockerLogs struct {
	ContainerID string `json:"container_id"`
	Tail        int    `json:"tail"`
	Content     string `json:"content"`
}

type dockerContainerRow struct {
	ID       string `json:"ID"`
	Names    string `json:"Names"`
	Image    string `json:"Image"`
	State    string `json:"State"`
	Status   string `json:"Status"`
	Ports    string `json:"Ports"`
	Networks string `json:"Networks"`
}

type dockerImageRow struct {
	ID           string `json:"ID"`
	Repository   string `json:"Repository"`
	Tag          string `json:"Tag"`
	Size         string `json:"Size"`
	CreatedSince string `json:"CreatedSince"`
}

type dockerVolumeRow struct {
	Name       string `json:"Name"`
	Driver     string `json:"Driver"`
	Mountpoint string `json:"Mountpoint"`
	Scope      string `json:"Scope"`
}

type dockerNetworkRow struct {
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	Driver   string `json:"Driver"`
	Scope    string `json:"Scope"`
	Internal any    `json:"Internal"`
}

func (s *Service) DockerOverview(ctx context.Context, sessionID string) (DockerOverview, error) {
	if err := s.requireDockerSession(sessionID); err != nil {
		return DockerOverview{}, err
	}
	probeCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()

	containerRows, err := dockerJSONLines[dockerContainerRow](probeCtx, "container", "ls", "-a", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	imageRows, err := dockerJSONLines[dockerImageRow](probeCtx, "image", "ls", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	volumeRows, err := dockerJSONLines[dockerVolumeRow](probeCtx, "volume", "ls", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	networkRows, err := dockerJSONLines[dockerNetworkRow](probeCtx, "network", "ls", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}

	overview := DockerOverview{
		Containers:  make([]DockerContainer, 0, len(containerRows)),
		Images:      make([]DockerImage, 0, len(imageRows)),
		Volumes:     make([]DockerVolume, 0, len(volumeRows)),
		Networks:    make([]DockerNetwork, 0, len(networkRows)),
		RefreshedAt: time.Now().UTC(),
	}
	for _, row := range containerRows {
		overview.Containers = append(overview.Containers, DockerContainer{
			ID: row.ID, Name: row.Names, Image: row.Image, State: row.State, Status: row.Status,
			Ports: row.Ports, Networks: row.Networks, Protected: protectedDockerTarget(row.ID),
		})
	}
	for _, row := range imageRows {
		overview.Images = append(overview.Images, DockerImage{ID: row.ID, Repository: row.Repository, Tag: row.Tag, Size: row.Size, CreatedSince: row.CreatedSince})
	}
	for _, row := range volumeRows {
		overview.Volumes = append(overview.Volumes, DockerVolume{Name: row.Name, Driver: row.Driver, Mountpoint: row.Mountpoint, Scope: row.Scope})
	}
	for _, row := range networkRows {
		overview.Networks = append(overview.Networks, DockerNetwork{ID: row.ID, Name: row.Name, Driver: row.Driver, Scope: row.Scope, Internal: parseDockerBool(row.Internal)})
	}
	return overview, nil
}

func (s *Service) DockerContainerLogs(ctx context.Context, sessionID, containerID string, tail int) (DockerLogs, error) {
	if err := s.requireDockerSession(sessionID); err != nil {
		return DockerLogs{}, err
	}
	if err := validateDockerIdentifier(containerID); err != nil {
		return DockerLogs{}, err
	}
	if tail < 20 {
		tail = 20
	}
	if tail > 1000 {
		tail = 1000
	}
	logsCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()
	command := exec.CommandContext(logsCtx, "docker", "container", "logs", "--tail", strconv.Itoa(tail), "--timestamps", containerID)
	output, err := command.CombinedOutput()
	if err != nil {
		return DockerLogs{}, dockerCommandError(logsCtx, err, output)
	}
	return DockerLogs{ContainerID: containerID, Tail: tail, Content: string(output)}, nil
}

func (s *Service) DockerContainerAction(ctx context.Context, sessionID, containerID, action string) error {
	if err := s.requireDockerSession(sessionID); err != nil {
		return err
	}
	if err := validateDockerIdentifier(containerID); err != nil {
		return err
	}
	if protectedDockerTarget(containerID) {
		return ErrDockerProtectedContainer
	}
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "start" && action != "stop" && action != "restart" {
		return fmt.Errorf("unsupported docker container action %q", action)
	}
	actionCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()
	output, err := exec.CommandContext(actionCtx, "docker", "container", action, containerID).CombinedOutput()
	if err != nil {
		return dockerCommandError(actionCtx, err, output)
	}
	return nil
}

func (s *Service) requireDockerSession(sessionID string) error {
	if s.store == nil {
		return errors.New("session store is unavailable")
	}
	_, err := s.store.Get(strings.TrimSpace(sessionID))
	return err
}

func dockerJSONLines[T any](ctx context.Context, args ...string) ([]T, error) {
	command := exec.CommandContext(ctx, "docker", args...)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, dockerCommandError(ctx, err, exitErr.Stderr)
		}
		return nil, dockerCommandError(ctx, err, nil)
	}
	rows := make([]T, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row T
		if err := jsonUnmarshalDockerRow([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("decode docker output: %w", err)
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read docker output: %w", err)
	}
	return rows, nil
}

func jsonUnmarshalDockerRow(data []byte, target any) error {
	return json.Unmarshal(data, target)
}

func validateDockerIdentifier(value string) error {
	if !dockerIdentifierPattern.MatchString(strings.TrimSpace(value)) {
		return errors.New("invalid docker container identifier")
	}
	return nil
}

func protectedDockerTarget(value string) bool {
	hostname, err := os.Hostname()
	if err != nil {
		return false
	}
	hostname = strings.TrimSpace(hostname)
	value = strings.TrimSpace(value)
	return hostname != "" && value != "" && (strings.HasPrefix(hostname, value) || strings.HasPrefix(value, hostname))
}

func dockerCommandError(ctx context.Context, err error, output []byte) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("%w: command timed out", ErrDockerUnavailable)
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%w: docker CLI not found", ErrDockerUnavailable)
	}
	message := strings.TrimSpace(string(output))
	if message == "" {
		message = strings.TrimSpace(err.Error())
	}
	lower := strings.ToLower(message)
	if strings.Contains(lower, "cannot connect to the docker daemon") || strings.Contains(lower, "is the docker daemon running") || strings.Contains(lower, "permission denied") {
		return fmt.Errorf("%w: %s", ErrDockerUnavailable, message)
	}
	return errors.New(message)
}

func parseDockerBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(typed))
		return parsed
	default:
		return false
	}
}

import { format } from 'date-fns';
import type { WorkoutSetDTO } from './types';
import type { LyfatGetWorkoutsResponse, LyfatGetWorkoutSummaryResponse } from './lyfta';

const DATE_FORMAT_LYFTA = 'd MMM yyyy, HH:mm';

const parseDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return format(date, DATE_FORMAT_LYFTA);
  } catch {
    return '';
  }
};

const parseDurationToMinutes = (durationStr: string | undefined): number => {
  if (!durationStr) return 0;
  try {
    const parts = durationStr.split(':');
    if (parts.length !== 3) return 0;
    
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return 0;
    
    return hours * 60 + minutes + Math.round(seconds / 60);
  } catch {
    return 0;
  }
};

const toNumber = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeSetType = (value: unknown): string => {
  const s = String(value ?? '').toLowerCase();

  if (s === '0') return 'normal';
  if (s === '1') return 'warmup';
  if (s === '2') return 'right';
  if (s === '3') return 'left';

  return 'normal';
};

export const mapLyfataWorkoutsToWorkoutSets = (
  workouts: LyfatGetWorkoutsResponse['workouts'],
  summaries: LyfatGetWorkoutSummaryResponse['workouts'] = []
): WorkoutSetDTO[] => {
  const out: WorkoutSetDTO[] = [];
  
  // Create a map of workout ID to duration for quick lookup
  const durationMap = new Map<number, number>();
  for (const summary of summaries) {
    const workoutId = parseInt(summary.id, 10);
    if (isNaN(workoutId)) continue;
    const duration = parseDurationToMinutes(summary.workout_duration);
    durationMap.set(workoutId, duration);
  }

  for (const w of workouts) {
    const title = String(w.title ?? 'Workout');
    const start_time = parseDate(w.workout_perform_date);
    
    // Calculate end_time based on duration from summary data
    const durationMinutes = durationMap.get(w.id) ?? 0;
    let end_time = start_time;
    
    if (durationMinutes > 0 && w.workout_perform_date) {
      const startDate = new Date(w.workout_perform_date);
      if (!isNaN(startDate.getTime())) {
        end_time = format(new Date(startDate.getTime() + durationMinutes * 60 * 1000), DATE_FORMAT_LYFTA);
      }
    }
    
    const description = '';

    for (const [exerciseIndex, ex] of (w.exercises ?? []).entries()) {
      const exercise_title = String(ex.excercise_name ?? '').trim();
      const exercise_notes = '';
      const superset_id = '';

      const setsForExercise = [...(ex.sets ?? [])].reverse();
      setsForExercise.forEach((s, setIdx) => {
        out.push({
          title,
          start_time,
          end_time,
          description,
          exercise_title,
          exercise_index: exerciseIndex,
          superset_id,
          exercise_notes,
          set_index: (ex.sets?.length ?? 1) - 1 - setIdx,
          set_type: normalizeSetType(s.set_type_id),
          weight_kg: toNumber(s.weight, 0),
          reps: toNumber(s.reps, 0),
          distance_km: toNumber(s.distance, 0),
          duration_seconds: toNumber(s.duration, ex.exercise_rest_time ?? 0),
          rpe: s.rir ? toNumber(s.rir, 0) > 0 ? 10 - toNumber(s.rir, 0) : null : null,
        });
      });
    }
  }

  return out;
};

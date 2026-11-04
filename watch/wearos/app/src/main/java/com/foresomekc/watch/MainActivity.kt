package com.foresomekc.watch

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Bundle
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.*
import com.google.android.gms.location.*
import org.json.JSONArray
import kotlin.math.max
import kotlin.math.roundToInt

private val Gold = Color(0xFFB89A5C)
private val Cream = Color(0xFFF1EAD9)
private val Forest = Color(0xFF1A2C20)

data class Course(val name: String, val pars: List<Int>, val greens: List<Pair<Double, Double>>) {
    val middle: Pair<Double, Double> get() = greens.map { it.first }.average() to greens.map { it.second }.average()
}

/** Course data bundled with the app (watch/shared/courses.json), so it works with no signal. */
fun loadCourses(ctx: Context): List<Course> {
    val arr = JSONArray(ctx.assets.open("courses.json").bufferedReader().use { it.readText() })
    return (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val pars = o.getJSONArray("pars").let { p -> (0 until p.length()).map { p.getInt(it) } }
        val greens = o.getJSONArray("greens").let { g ->
            (0 until g.length()).map { val pt = g.getJSONArray(it); pt.getDouble(0) to pt.getDouble(1) }
        }
        Course(o.getString("name"), pars, greens)
    }
}

fun yards(from: Location, to: Pair<Double, Double>): Int {
    val out = FloatArray(1)
    Location.distanceBetween(from.latitude, from.longitude, to.first, to.second, out)
    return (out[0] * 1.09361f).roundToInt()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val courses = loadCourses(this)
        setContent { MaterialTheme(colors = Colors(primary = Gold, onPrimary = Forest, background = Color.Black, onBackground = Cream)) { App(courses) } }
    }
}

@SuppressLint("MissingPermission")  // permission is checked via `granted` before requesting updates
@Composable
fun rememberLocation(): Pair<Location?, Boolean> {
    val ctx = LocalContext.current
    var location by remember { mutableStateOf<Location?>(null) }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.ACCESS_FINE_LOCATION) }

    DisposableEffect(granted) {
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.takeIf { it.accuracy < 50f }?.let { location = it }
            }
        }
        if (granted) {
            val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000L).setMinUpdateDistanceMeters(2f).build()
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        }
        onDispose { client.removeLocationUpdates(callback) }
    }
    return location to granted
}

@Composable
fun App(courses: List<Course>) {
    val (here, granted) = rememberLocation()
    var selected by remember { mutableStateOf<Course?>(null) }
    val course = selected
    if (course == null) CourseList(courses, here, granted) { selected = it }
    else HoleScreen(course, here, granted) { selected = null }
}

@Composable
fun CourseList(courses: List<Course>, here: Location?, granted: Boolean, onPick: (Course) -> Unit) {
    val sorted = if (here == null) courses else courses.sortedBy { yards(here, it.middle) }
    val sub: (Course) -> String? = { c ->
        here?.let { h -> val mi = yards(h, c.middle) / 1760.0; if (mi < 0.5) "You're here" else "%.1f mi".format(mi) }
    }
    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
            item { Text("ForeSome", color = Gold, fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 18.sp) }
            if (!granted) item { Text("Allow location to see distances", fontSize = 12.sp, textAlign = TextAlign.Center) }
            items(sorted) { c ->
                Chip(
                    onClick = { onPick(c) },
                    label = { Text(c.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = if (sub(c) != null) { { Text(sub(c)!!) } } else null,
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
fun HoleScreen(course: Course, here: Location?, granted: Boolean, onBack: () -> Unit) {
    var hole by remember { mutableIntStateOf(1) }
    val center = here?.let { yards(it, course.greens[hole - 1]) }
    Scaffold(timeText = { TimeText() }) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Text("Hole $hole · Par ${course.pars[hole - 1]}", color = Gold, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            if (center != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$center", fontSize = 52.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, color = Cream)
                    Text("F ${max(0, center - 6)} · B ${center + 6}", fontSize = 13.sp, color = Cream.copy(alpha = 0.7f))
                }
            } else {
                Text(if (granted) "Finding GPS…" else "Location is off", fontSize = 14.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactButton(onClick = { if (hole > 1) hole-- else onBack() }) { Text(if (hole > 1) "‹" else "✕") }
                CompactButton(onClick = { if (hole < course.pars.size) hole++ }, enabled = hole < course.pars.size) { Text("›") }
            }
        }
    }
}
